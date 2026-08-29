import { prisma } from "../lib/prisma.js";
import { inventoryWriteService } from "./inventory-write.service.js";
import { auditService } from "./audit.service.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { StatusCodes } from "http-status-codes";
import { Prisma, InventoryReservationStatus, UserRole } from "@prisma/client";

export const onlineStoreFulfilmentService = {
  /**
   * Helper: asserts order access based on user role and branch assignments
   */
  async assertOrderAccess(auth: any, order: any) {
    if (auth.role === UserRole.GENERAL_MANAGER) return;
    
    // Attendants and Branch Managers can only see/work on orders assigned to their branch
    const branchIds = auth.branchIds || [];
    const assignedBranchId = order.pickupBranchId || order.pickupBranch?.id || null;
    
    if (order.deliveryMethod === "PICKUP" && (!assignedBranchId || !branchIds.includes(assignedBranchId))) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Access denied: Order pickup branch mismatch", StatusCodes.FORBIDDEN);
    }
  },

  /**
   * 11. CONFIRM ORDER
   */
  async confirmOrder(auth: any, orderId: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: true,
          deliveryZone: true,
          pickupBranch: true,
          paymentAttempts: true
        }
      });

      await this.assertOrderAccess(auth, order);

      if (order.status === "CONFIRMED") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Order is already confirmed", StatusCodes.BAD_REQUEST);
      }
      if (order.status === "CANCELLED" || order.status === "EXPIRED" || order.status === "REJECTED") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, `Cannot confirm order in status: ${order.status}`, StatusCodes.BAD_REQUEST);
      }

      // Check payment eligibility
      const isCOD = order.paymentAttempts.some(a => a.method === "CASH_ON_DELIVERY");
      if (isCOD) {
        // COD checks
        if (order.paymentStatus !== "UNPAID") {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "COD orders must be unpaid upon confirmation", StatusCodes.BAD_REQUEST);
        }
      } else {
        // M-Pesa check: must be PAID
        if (order.paymentStatus !== "PAID") {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "M-Pesa orders must be paid before confirmation", StatusCodes.BAD_REQUEST);
        }
      }

      // Confirm order status transition
      const updatedOrder = await tx.onlineOrder.update({
        where: { id: orderId },
        data: {
          status: "CONFIRMED",
          fulfilmentStatus: "RESERVATION_PENDING"
        }
      });

      // Audit log
      await auditService.create({
        organizationId: auth.organizationId,
        branchId: order.pickupBranchId || null,
        userId: auth.userId,
        action: "online_order.confirm",
        entityType: "OnlineOrder",
        entityId: order.id,
        requestId: requestDetails?.requestId,
        ipAddress: requestDetails?.ip,
        userAgent: requestDetails?.userAgent,
        beforeData: { status: order.status, fulfilmentStatus: order.fulfilmentStatus },
        afterData: { status: "CONFIRMED", fulfilmentStatus: "RESERVATION_PENDING" }
      }, tx);

      // Create internal notification
      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          branchId: order.pickupBranchId || null,
          type: "ONLINE_ORDER",
          title: `Order ${order.orderNumber} Confirmed`,
          message: `Order ${order.orderNumber} has been confirmed operationally and is ready for reservation.`
        }
      });

      return updatedOrder;
    });
  },

  /**
   * 12. REJECT ORDER
   */
  async rejectOrder(auth: any, orderId: string, reason: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, paymentAttempts: true }
      });

      await this.assertOrderAccess(auth, order);

      if (order.status === "CANCELLED" || order.status === "REJECTED") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Order is already cancelled/rejected", StatusCodes.BAD_REQUEST);
      }

      // If there are active reservations, release them
      const reservations = await tx.inventoryReservation.findMany({
        where: {
          organizationId: auth.organizationId,
          sourceType: "ONLINE_ORDER",
          sourceId: order.id,
          status: InventoryReservationStatus.ACTIVE
        }
      });

      for (const res of reservations) {
        await inventoryWriteService.releaseReservation(tx, res.id);
      }

      // Rejection status: if pre-paid, needs refund process
      const isPaid = order.paymentStatus === "PAID";
      const targetStatus = "REJECTED";
      const targetFulfilmentStatus = isPaid ? "FAILED" : "CANCELLED";

      const updatedOrder = await tx.onlineOrder.update({
        where: { id: orderId },
        data: {
          status: targetStatus,
          fulfilmentStatus: targetFulfilmentStatus,
          notes: order.notes ? `${order.notes}\nRejection Reason: ${reason}` : `Rejection Reason: ${reason}`
        }
      });

      // Audit Log
      await auditService.create({
        organizationId: auth.organizationId,
        branchId: order.pickupBranchId || null,
        userId: auth.userId,
        action: "online_order.reject",
        entityType: "OnlineOrder",
        entityId: order.id,
        requestId: requestDetails?.requestId,
        ipAddress: requestDetails?.ip,
        userAgent: requestDetails?.userAgent,
        beforeData: { status: order.status, fulfilmentStatus: order.fulfilmentStatus },
        afterData: { status: targetStatus, fulfilmentStatus: targetFulfilmentStatus, reason }
      }, tx);

      // Create notification
      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          branchId: order.pickupBranchId || null,
          type: "ONLINE_ORDER",
          title: `Order ${order.orderNumber} Rejected`,
          message: `Order ${order.orderNumber} was rejected. Reason: ${reason}. ${isPaid ? "REFUND REQUIRED." : ""}`
        }
      });

      return updatedOrder;
    });
  },

  /**
   * 13. INVENTORY RESERVATION
   */
  async reserveStock(auth: any, orderId: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { include: { productVariant: true } } }
      });

      await this.assertOrderAccess(auth, order);

      if (order.status !== "CONFIRMED") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Inventory reservation is only allowed for CONFIRMED orders", StatusCodes.BAD_REQUEST);
      }

      const branchId = order.pickupBranchId || (await tx.branch.findFirst({ where: { organizationId: auth.organizationId } }))?.id;
      if (!branchId) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "No active fulfilment branch allocated to order", StatusCodes.BAD_REQUEST);
      }

      // Check current availability for all items before reserving
      for (const item of order.items) {
        const balance = await tx.inventoryBalance.findUnique({
          where: {
            organizationId_branchId_productVariantId: {
              organizationId: auth.organizationId,
              branchId,
              productVariantId: item.productVariantId
            }
          }
        });

        const available = balance ? Number(balance.quantityAvailable) : 0;
        if (available < item.quantity) {
          // Update Order to RESERVATION_FAILED
          await tx.onlineOrder.update({
            where: { id: orderId },
            data: { fulfilmentStatus: "RESERVATION_FAILED" }
          });

          await tx.notification.create({
            data: {
              organizationId: auth.organizationId,
              branchId,
              type: "ONLINE_ORDER",
              title: `Reservation Failed: Order ${order.orderNumber}`,
              message: `Shortage for variant ${item.productVariant.sku}. Required: ${item.quantity}, Available: ${available}`
            }
          });

          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Insufficient stock for reservation. SKU: ${item.productVariant.sku}. Required: ${item.quantity}, Available: ${available}`,
            StatusCodes.BAD_REQUEST
          );
        }
      }

      // Perform reservations using inventoryWriteService
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 48); // 48 hours reservation lease

      for (const item of order.items) {
        await inventoryWriteService.reserveStock(tx, {
          organizationId: auth.organizationId,
          branchId,
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          sourceType: "ONLINE_ORDER",
          sourceId: order.id,
          expiresAt
        });
      }

      const updatedOrder = await tx.onlineOrder.update({
        where: { id: orderId },
        data: { fulfilmentStatus: "RESERVED" }
      });

      // Audit
      await auditService.create({
        organizationId: auth.organizationId,
        branchId,
        userId: auth.userId,
        action: "online_order.reserve",
        entityType: "OnlineOrder",
        entityId: order.id,
        requestId: requestDetails?.requestId,
        ipAddress: requestDetails?.ip,
        userAgent: requestDetails?.userAgent,
        afterData: { fulfilmentStatus: "RESERVED" }
      }, tx);

      return updatedOrder;
    });
  },

  /**
   * 16. RELEASE RESERVATION
   */
  async releaseReservation(auth: any, orderId: string, reason: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUniqueOrThrow({
        where: { id: orderId }
      });

      await this.assertOrderAccess(auth, order);

      const reservations = await tx.inventoryReservation.findMany({
        where: {
          organizationId: auth.organizationId,
          sourceType: "ONLINE_ORDER",
          sourceId: order.id,
          status: InventoryReservationStatus.ACTIVE
        }
      });

      for (const res of reservations) {
        await inventoryWriteService.releaseReservation(tx, res.id);
      }

      const updatedOrder = await tx.onlineOrder.update({
        where: { id: orderId },
        data: { fulfilmentStatus: "UNFULFILLED" }
      });

      // Audit
      await auditService.create({
        organizationId: auth.organizationId,
        branchId: order.pickupBranchId || null,
        userId: auth.userId,
        action: "online_order.release_reservation",
        entityType: "OnlineOrder",
        entityId: order.id,
        requestId: requestDetails?.requestId,
        ipAddress: requestDetails?.ip,
        userAgent: requestDetails?.userAgent,
        afterData: { fulfilmentStatus: "UNFULFILLED", reason }
      }, tx);

      return updatedOrder;
    });
  },

  /**
   * 18. PICKER ASSIGNMENT
   */
  async assignPicker(auth: any, orderId: string, pickerId: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true }
      });

      await this.assertOrderAccess(auth, order);

      if (order.fulfilmentStatus !== "RESERVED" && order.fulfilmentStatus !== "RESERVATION_FAILED" && order.fulfilmentStatus !== "UNFULFILLED") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Order must be reserved before picking assignment", StatusCodes.BAD_REQUEST);
      }

      const branchId = order.pickupBranchId || (await tx.branch.findFirst({ where: { organizationId: auth.organizationId } }))?.id;
      if (!branchId) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Branch mismatch or missing", StatusCodes.BAD_REQUEST);
      }

      // Check picker's branch assignment
      const assignment = await tx.userBranchAssignment.findFirst({
        where: { userId: pickerId, branchId }
      });
      if (!assignment && auth.role !== UserRole.GENERAL_MANAGER) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Picker must be assigned to the order's fulfilment branch", StatusCodes.BAD_REQUEST);
      }

      // Create picking task
      const pickingTask = await tx.pickingTask.create({
        data: {
          organizationId: auth.organizationId,
          branchId,
          onlineOrderId: order.id,
          assignedToId: pickerId,
          status: "ASSIGNED"
        }
      });

      // Create picking task items
      for (const item of order.items) {
        await tx.pickingTaskItem.create({
          data: {
            pickingTaskId: pickingTask.id,
            onlineOrderItemId: item.id,
            productVariantId: item.productVariantId,
            requiredQuantity: item.quantity,
            pickedQuantity: 0,
            shortQuantity: 0,
            status: "PENDING"
          }
        });
      }

      const updatedOrder = await tx.onlineOrder.update({
        where: { id: orderId },
        data: { fulfilmentStatus: "PICKING" }
      });

      // Audit
      await auditService.create({
        organizationId: auth.organizationId,
        branchId,
        userId: auth.userId,
        action: "online_order.assign_picker",
        entityType: "OnlineOrder",
        entityId: order.id,
        requestId: requestDetails?.requestId,
        ipAddress: requestDetails?.ip,
        userAgent: requestDetails?.userAgent,
        afterData: { pickingTaskId: pickingTask.id, assignedToId: pickerId }
      }, tx);

      return { order: updatedOrder, pickingTask };
    });
  },

  /**
   * 19. START PICKING
   */
  async startPicking(auth: any, orderId: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const pickingTask = await tx.pickingTask.findFirstOrThrow({
        where: { onlineOrderId: orderId, organizationId: auth.organizationId, status: "ASSIGNED" }
      });

      const updatedTask = await tx.pickingTask.update({
        where: { id: pickingTask.id },
        data: {
          status: "IN_PROGRESS",
          startedAt: new Date()
        }
      });

      return updatedTask;
    });
  },

  /**
   * 19. PICK ITEMS
   */
  async pickItems(
    auth: any,
    orderId: string,
    pickedLines: Array<{ pickingTaskItemId: string; pickedQuantity: number; shortQuantity: number; inventoryBatchId?: string; notes?: string }>,
    requestDetails?: { ip?: string; userAgent?: string; requestId?: string }
  ) {
    return prisma.$transaction(async (tx) => {
      const pickingTask = await tx.pickingTask.findFirstOrThrow({
        where: { onlineOrderId: orderId, organizationId: auth.organizationId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } }
      });

      for (const line of pickedLines) {
        const taskItem = await tx.pickingTaskItem.findUniqueOrThrow({
          where: { id: line.pickingTaskItemId }
        });

        // Update task item
        await tx.pickingTaskItem.update({
          where: { id: line.pickingTaskItemId },
          data: {
            pickedQuantity: line.pickedQuantity,
            shortQuantity: line.shortQuantity,
            inventoryBatchId: line.inventoryBatchId || null,
            status: line.shortQuantity > 0 ? "SHORT" : "PICKED",
            notes: line.notes || null
          }
        });

        // Update online order item counters
        await tx.onlineOrderItem.update({
          where: { id: taskItem.onlineOrderItemId },
          data: {
            pickedQuantity: line.pickedQuantity
          }
        });
      }

      return { success: true };
    });
  },

  /**
   * 19. COMPLETE PICKING
   */
  async completePicking(auth: any, orderId: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const pickingTask = await tx.pickingTask.findFirstOrThrow({
        where: { onlineOrderId: orderId, organizationId: auth.organizationId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
        include: { items: true }
      });

      const order = await tx.onlineOrder.findUniqueOrThrow({ where: { id: orderId } });

      const hasShorts = pickingTask.items.some(item => Number(item.shortQuantity) > 0);
      const finalStatus = hasShorts ? "PARTIALLY_PICKED" : "COMPLETED";

      const updatedTask = await tx.pickingTask.update({
        where: { id: pickingTask.id },
        data: {
          status: finalStatus,
          completedAt: new Date()
        }
      });

      // Update Order fulfilment status
      const orderFulfilmentStatus = hasShorts ? "PARTIALLY_PICKED" : "PICKED";
      await tx.onlineOrder.update({
        where: { id: orderId },
        data: {
          fulfilmentStatus: orderFulfilmentStatus
        }
      });

      // Automatically instantiate Packing Task
      const branchId = order.pickupBranchId || pickingTask.branchId;
      await tx.packingTask.create({
        data: {
          organizationId: auth.organizationId,
          branchId,
          onlineOrderId: orderId,
          status: "PENDING"
        }
      });

      // Audit
      await auditService.create({
        organizationId: auth.organizationId,
        branchId,
        userId: auth.userId,
        action: "online_order.complete_picking",
        entityType: "OnlineOrder",
        entityId: orderId,
        requestId: requestDetails?.requestId,
        ipAddress: requestDetails?.ip,
        userAgent: requestDetails?.userAgent,
        afterData: { pickingTaskStatus: finalStatus, orderFulfilmentStatus }
      }, tx);

      return updatedTask;
    });
  },

  /**
   * 24. ASSIGN PACKER
   */
  async assignPacker(auth: any, orderId: string, packerId: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const packingTask = await tx.packingTask.findFirstOrThrow({
        where: { onlineOrderId: orderId, organizationId: auth.organizationId, status: "PENDING" }
      });

      const updatedTask = await tx.packingTask.update({
        where: { id: packingTask.id },
        data: {
          assignedToId: packerId,
          status: "ASSIGNED",
          startedAt: new Date()
        }
      });

      await tx.onlineOrder.update({
        where: { id: orderId },
        data: { fulfilmentStatus: "PACKING" }
      });

      return updatedTask;
    });
  },

  /**
   * 25. COMPLETE PACKING
   */
  async completePacking(
    auth: any,
    orderId: string,
    details: { packageCount: number; totalWeight: number; notes?: string },
    requestDetails?: { ip?: string; userAgent?: string; requestId?: string }
  ) {
    return prisma.$transaction(async (tx) => {
      const packingTask = await tx.packingTask.findFirstOrThrow({
        where: { onlineOrderId: orderId, organizationId: auth.organizationId, status: { in: ["ASSIGNED", "PENDING"] } }
      });

      const updatedTask = await tx.packingTask.update({
        where: { id: packingTask.id },
        data: {
          status: "COMPLETED",
          packageCount: details.packageCount,
          totalWeight: details.totalWeight,
          notes: details.notes || null,
          completedAt: new Date()
        }
      });

      // Update item packed quantities
      const orderItems = await tx.onlineOrderItem.findMany({ where: { orderId } });
      for (const item of orderItems) {
        await tx.onlineOrderItem.update({
          where: { id: item.id },
          data: {
            packedQuantity: item.pickedQuantity // Packs what was picked
          }
        });
      }

      await tx.onlineOrder.update({
        where: { id: orderId },
        data: { fulfilmentStatus: "PACKED" }
      });

      // Audit
      await auditService.create({
        organizationId: auth.organizationId,
        branchId: packingTask.branchId,
        userId: auth.userId,
        action: "online_order.complete_packing",
        entityType: "OnlineOrder",
        entityId: orderId,
        requestId: requestDetails?.requestId,
        ipAddress: requestDetails?.ip,
        userAgent: requestDetails?.userAgent,
        afterData: { packageCount: details.packageCount, totalWeight: details.totalWeight }
      }, tx);

      return updatedTask;
    });
  },

  /**
   * 28. READY FOR DISPATCH
   */
  async readyForDispatch(auth: any, orderId: string, requestDetails?: { ip?: string; userAgent?: string; requestId?: string }) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUniqueOrThrow({
        where: { id: orderId }
      });

      await this.assertOrderAccess(auth, order);

      if (order.fulfilmentStatus !== "PACKED") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Order must be PACKED before marking ready for dispatch", StatusCodes.BAD_REQUEST);
      }

      const updatedOrder = await tx.onlineOrder.update({
        where: { id: orderId },
        data: { fulfilmentStatus: "READY_FOR_DISPATCH" }
      });

      return updatedOrder;
    });
  },

  /**
   * 30. DISPATCH
   */
  async dispatchOrder(
    auth: any,
    orderId: string,
    details: { courierName?: string; courierService?: string; trackingNumber?: string; vehicleReference?: string; driverName?: string; driverPhone?: string; notes?: string },
    requestDetails?: { ip?: string; userAgent?: string; requestId?: string }
  ) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: { include: { productVariant: { include: { product: true } } } },
          paymentAttempts: true,
          customer: true
        }
      });

      await this.assertOrderAccess(auth, order);

      if (order.fulfilmentStatus !== "READY_FOR_DISPATCH") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Order must be in READY_FOR_DISPATCH state", StatusCodes.BAD_REQUEST);
      }

      // Check payment requirements
      const isCOD = order.paymentAttempts.some(a => a.method === "CASH_ON_DELIVERY");
      if (!isCOD && order.paymentStatus !== "PAID") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Prepaid M-Pesa orders must be paid before dispatch", StatusCodes.BAD_REQUEST);
      }

      const branchId = order.pickupBranchId || (await tx.branch.findFirst({ where: { organizationId: auth.organizationId } }))?.id || "default_branch";

      // 31. Consume Reservations & Deduct Stock
      const activeReservations = await tx.inventoryReservation.findMany({
        where: {
          organizationId: auth.organizationId,
          sourceType: "ONLINE_ORDER",
          sourceId: orderId,
          status: InventoryReservationStatus.ACTIVE
        }
      });

      // Deduct stock using FIFO and consume reservations
      for (const res of activeReservations) {
        await inventoryWriteService.fulfillReservation(tx, res.id, auth.userId);
      }

      // 32. Create final Sale & SaleItems
      const saleCount = await tx.sale.count({ where: { organizationId: auth.organizationId } });
      const saleNumber = `SAL-${(saleCount + 1).toString().padStart(6, "0")}`;

      const sale = await tx.sale.create({
        data: {
          organizationId: auth.organizationId,
          branchId,
          customerId: order.customerId,
          saleNumber,
          saleType: "RETAIL",
          attendantId: auth.userId,
          currencyCode: "KES",
          status: "COMPLETED",
          paymentStatus: order.paymentStatus === "PAID" ? "PAID" : "UNPAID",
          fulfillmentStatus: "COMPLETED",
          subtotal: order.subtotal,
          lineDiscountAmount: 0,
          orderDiscountAmount: 0,
          taxAmount: order.taxAmount,
          totalAmount: order.totalAmount,
          amountPaid: order.paymentStatus === "PAID" ? order.totalAmount : 0,
          amountDue: order.paymentStatus === "PAID" ? 0 : order.totalAmount,
          notes: order.notes || "Online storefront sale completed at dispatch",
          completedAt: new Date()
        }
      });

      // Link Sale Items
      for (const item of order.items) {
        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productVariantId: item.productVariantId,
            skuSnapshot: item.skuSnapshot,
            productNameSnapshot: item.productNameSnapshot,
            variantSnapshot: item.variantNameSnapshot,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            originalUnitPrice: item.productVariant.retailPrice,
            discountAmount: 0,
            taxRate: 0,
            taxAmount: 0,
            unitCost: 0,
            lineCost: 0,
            lineSubtotal: item.lineTotal,
            lineTotal: item.lineTotal,
            grossProfit: 0,
            notes: null
          }
        });
      }

      // 33. Create dispatch record
      const dispatch = await tx.orderDispatch.create({
        data: {
          organizationId: auth.organizationId,
          onlineOrderId: orderId,
          branchId,
          courierName: details.courierName || null,
          courierService: details.courierService || null,
          trackingNumber: details.trackingNumber || null,
          vehicleReference: details.vehicleReference || null,
          driverName: details.driverName || null,
          driverPhone: details.driverPhone || null,
          dispatchedById: auth.userId,
          dispatchedAt: new Date(),
          status: "DISPATCHED",
          notes: details.notes || null
        }
      });

      // Update Order fulfilment and status to DISPATCHED
      const updatedOrder = await tx.onlineOrder.update({
        where: { id: orderId },
        data: {
          status: "DISPATCHED",
          fulfilmentStatus: "DISPATCHED"
        }
      });

      // Audit log
      await auditService.create({
        organizationId: auth.organizationId,
        branchId,
        userId: auth.userId,
        action: "online_order.dispatch",
        entityType: "OnlineOrder",
        entityId: orderId,
        requestId: requestDetails?.requestId,
        ipAddress: requestDetails?.ip,
        userAgent: requestDetails?.userAgent,
        afterData: { status: "DISPATCHED", fulfilmentStatus: "DISPATCHED", saleId: sale.id, dispatchId: dispatch.id }
      }, tx);

      return updatedOrder;
    });
  },

  /**
   * 36. COD DELIVERY CONFIRMATION & PREPAID DELIVERY
   */
  async confirmDelivery(
    auth: any,
    orderId: string,
    details: { outcome: string; amountCollected?: number; notes?: string; reference?: string },
    requestDetails?: { ip?: string; userAgent?: string; requestId?: string }
  ) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { paymentAttempts: true }
      });

      await this.assertOrderAccess(auth, order);

      if (order.status !== "DISPATCHED") {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Only dispatched orders can be delivered", StatusCodes.BAD_REQUEST);
      }

      const branchId = order.pickupBranchId || (await tx.branch.findFirst({ where: { organizationId: auth.organizationId } }))?.id || "default_branch";

      // If outcome is successful
      if (details.outcome === "DELIVERED") {
        const isCOD = order.paymentAttempts.some(a => a.method === "CASH_ON_DELIVERY");
        if (isCOD) {
          // COD Payment generation
          if (Number(details.amountCollected) !== Number(order.totalAmount)) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, `COD Collected amount mismatch. Expected KES ${order.totalAmount}`, StatusCodes.BAD_REQUEST);
          }

          const payCount = await tx.payment.count({ where: { organizationId: auth.organizationId } });
          const paymentNumber = `PMT-${(payCount + 1).toString().padStart(6, "0")}`;

          // Create payment record
          await tx.payment.create({
            data: {
              organizationId: auth.organizationId,
              branchId,
              paymentNumber,
              customerId: order.customerId,
              onlineOrderId: order.id,
              direction: "INCOMING",
              paymentMethod: "CASH",
              amount: order.totalAmount,
              currencyCode: "KES",
              reference: details.reference || `COD-COLLECT-${order.orderNumber}`,
              status: "COMPLETED",
              receivedById: auth.userId,
              receivedAt: new Date()
            }
          });

          // Mark paymentStatus PAID on order
          await tx.onlineOrder.update({
            where: { id: orderId },
            data: {
              paymentStatus: "PAID"
            }
          });

          // Also update Sales record paymentStatus and amountPaid
          const linkedSale = await tx.sale.findFirst({ where: { organizationId: auth.organizationId, customerId: order.customerId, totalAmount: order.totalAmount } });
          if (linkedSale) {
            await tx.sale.update({
              where: { id: linkedSale.id },
              data: {
                paymentStatus: "PAID",
                amountPaid: order.totalAmount,
                amountDue: 0
              }
            });
          }
        }

        // Update Dispatch record to DELIVERED
        await tx.orderDispatch.update({
          where: { onlineOrderId: orderId },
          data: {
            status: "DELIVERED",
            deliveredAt: new Date()
          }
        });

        // Update Order status and fulfilment status
        const updatedOrder = await tx.onlineOrder.update({
          where: { id: orderId },
          data: {
            status: "DELIVERED",
            fulfilmentStatus: "DELIVERED"
          }
        });

        // Audit
        await auditService.create({
          organizationId: auth.organizationId,
          branchId,
          userId: auth.userId,
          action: "online_order.deliver",
          entityType: "OnlineOrder",
          entityId: orderId,
          requestId: requestDetails?.requestId,
          ipAddress: requestDetails?.ip,
          userAgent: requestDetails?.userAgent,
          afterData: { status: "DELIVERED", fulfilmentStatus: "DELIVERED" }
        }, tx);

        return updatedOrder;
      } else {
        // Delivery failed attempt / exceptions
        await tx.orderDispatch.update({
          where: { onlineOrderId: orderId },
          data: {
            status: "FAILED",
            notes: `Delivery outcome: ${details.outcome}. Notes: ${details.notes}`
          }
        });

        const updatedOrder = await tx.onlineOrder.update({
          where: { id: orderId },
          data: {
            fulfilmentStatus: "FAILED"
          }
        });

        await tx.notification.create({
          data: {
            organizationId: auth.organizationId,
            branchId,
            type: "ONLINE_ORDER",
            title: `Delivery Exception for ${order.orderNumber}`,
            message: `Delivery outcome: ${details.outcome}. Reason: ${details.notes || "None specified"}`
          }
        });

        // Audit
        await auditService.create({
          organizationId: auth.organizationId,
          branchId,
          userId: auth.userId,
          action: "online_order.delivery_failed",
          entityType: "OnlineOrder",
          entityId: orderId,
          requestId: requestDetails?.requestId,
          ipAddress: requestDetails?.ip,
          userAgent: requestDetails?.userAgent,
          afterData: { status: "DISPATCHED", fulfilmentStatus: "FAILED", outcome: details.outcome }
        }, tx);

        return updatedOrder;
      }
    });
  }
};
