import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { sendSuccess } from "../../utils/api-response.js";
import { Prisma, UserRole } from "@prisma/client";

export const onlineStoreController = {
  // -------------------------------------------------------------
  // ONLINE ORDERS
  // -------------------------------------------------------------
  async listOrders(req: Request, res: Response) {
    const orgId = req.auth!.organizationId;
    const role = req.auth!.role;
    const branchIds = req.auth!.branchIds || [];

    // Filters
    const { status, search } = req.query;

    const whereClause: any = {
      organizationId: orgId,
    };

    // If branch manager, restrict to orders assigned to their branch for pickup
    if (role === UserRole.BRANCH_MANAGER) {
      whereClause.OR = [
        { pickupBranchId: { in: branchIds } },
        { deliveryMethod: "DELIVERY" } // Branch managers can view delivery orders too
      ];
    } else if (role === UserRole.SALES_ATTENDANT) {
      // Sales attendants shouldn't see online orders in Stage 2 unless they are pickup at their branch
      whereClause.pickupBranchId = { in: branchIds };
    }

    if (status) {
      whereClause.status = String(status);
    }

    if (search) {
      whereClause.OR = [
        { orderNumber: { contains: String(search), mode: "insensitive" } },
        { customer: { firstName: { contains: String(search), mode: "insensitive" } } },
        { customer: { lastName: { contains: String(search), mode: "insensitive" } } },
        { customer: { phone: { contains: String(search) } } },
      ];
    }

    const orders = await prisma.onlineOrder.findMany({
      where: whereClause,
      include: {
        customer: {
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        pickupBranch: {
          select: {
            name: true,
            code: true,
          },
        },
        deliveryZone: {
          select: {
            name: true,
          },
        },
        _count: {
          select: { items: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return sendSuccess(res, "Orders fetched successfully", orders);
  },

  async getOrder(req: Request, res: Response) {
    const orgId = req.auth!.organizationId;
    const { id } = req.params;

    const order = await prisma.onlineOrder.findFirst({
      where: { id, organizationId: orgId },
      include: {
        customer: true,
        pickupBranch: true,
        deliveryZone: true,
        addressSnapshot: true,
        paymentAttempts: {
          orderBy: { createdAt: "desc" }
        },
        payments: true,
        items: {
          include: {
            productVariant: {
              include: {
                product: {
                  include: {
                    media: {
                      where: { isPublished: true },
                      orderBy: { displayOrder: "asc" },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found", StatusCodes.NOT_FOUND);
    }

    return sendSuccess(res, "Order details fetched successfully", order);
  },

  async updateOrderStatus(req: Request, res: Response) {
    const orgId = req.auth!.organizationId;
    const { id } = req.params;
    const { status, paymentStatus } = req.body;

    const order = await prisma.onlineOrder.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found", StatusCodes.NOT_FOUND);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Find latest pending payment attempt
      const pendingAttempt = await tx.onlineOrderPaymentAttempt.findFirst({
        where: { onlineOrderId: order.id, status: "PENDING" },
        orderBy: { createdAt: "desc" }
      });

      if (pendingAttempt && paymentStatus === "PAID") {
        // Complete the attempt
        await tx.onlineOrderPaymentAttempt.update({
          where: { id: pendingAttempt.id },
          data: { status: "COMPLETED", completedAt: new Date() }
        });
      }

      // Check if we need to post a Payment record (if not already exists)
      const existingPayment = await tx.payment.findFirst({
        where: { onlineOrderId: order.id, status: "COMPLETED" }
      });

      if (!existingPayment && paymentStatus === "PAID") {
        const payCount = await tx.payment.count({ where: { organizationId: orgId } });
        const paymentNumber = `PMT-${(payCount + 1).toString().padStart(6, "0")}`;
        
        await tx.payment.create({
          data: {
            organizationId: orgId,
            branchId: order.pickupBranchId || (await tx.branch.findFirst({ where: { organizationId: orgId } }))?.id || "default_branch",
            paymentNumber,
            customerId: order.customerId,
            onlineOrderId: order.id,
            direction: "INCOMING",
            paymentMethod: pendingAttempt?.method === "CASH_ON_DELIVERY" ? "CASH" : "MPESA",
            amount: order.totalAmount,
            currencyCode: "KES",
            reference: pendingAttempt?.externalReference || `COD-${order.orderNumber}`,
            status: "COMPLETED",
            receivedById: req.auth!.userId,
            receivedAt: new Date()
          }
        });
      }

      // Update online order record
      return tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          status: status || order.status,
          paymentStatus: paymentStatus || order.paymentStatus,
        }
      });
    });

    return sendSuccess(res, "Order status updated successfully", updated);
  },

  // -------------------------------------------------------------
  // DELIVERY ZONES
  // -------------------------------------------------------------
  async listDeliveryZones(req: Request, res: Response) {
    const orgId = req.auth!.organizationId;

    const zones = await prisma.deliveryZone.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });

    return sendSuccess(res, "Delivery zones fetched successfully", zones);
  },

  async createDeliveryZone(req: Request, res: Response) {
    const orgId = req.auth!.organizationId;
    const { name, description, fee, minAmountForFreeDelivery, isActive = true } = req.body;

    if (!name || fee === undefined) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Name and Fee are required", StatusCodes.BAD_REQUEST);
    }

    // Check unique name
    const duplicate = await prisma.deliveryZone.findFirst({
      where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } },
    });

    if (duplicate) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "A delivery zone with this name already exists", StatusCodes.CONFLICT);
    }

    const zone = await prisma.deliveryZone.create({
      data: {
        organizationId: orgId,
        name,
        description,
        fee: new Prisma.Decimal(fee),
        minAmountForFreeDelivery: minAmountForFreeDelivery !== null && minAmountForFreeDelivery !== undefined
          ? new Prisma.Decimal(minAmountForFreeDelivery)
          : null,
        isActive,
      },
    });

    return sendSuccess(res, "Delivery zone created successfully", zone);
  },

  async updateDeliveryZone(req: Request, res: Response) {
    const orgId = req.auth!.organizationId;
    const { id } = req.params;
    const { name, description, fee, minAmountForFreeDelivery, isActive } = req.body;

    const zone = await prisma.deliveryZone.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!zone) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Delivery zone not found", StatusCodes.NOT_FOUND);
    }

    if (name) {
      const duplicate = await prisma.deliveryZone.findFirst({
        where: {
          organizationId: orgId,
          name: { equals: name, mode: "insensitive" },
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "A delivery zone with this name already exists", StatusCodes.CONFLICT);
      }
    }

    const updated = await prisma.deliveryZone.update({
      where: { id: zone.id },
      data: {
        name: name !== undefined ? name : zone.name,
        description: description !== undefined ? description : zone.description,
        fee: fee !== undefined ? new Prisma.Decimal(fee) : zone.fee,
        minAmountForFreeDelivery: minAmountForFreeDelivery !== undefined
          ? (minAmountForFreeDelivery !== null ? new Prisma.Decimal(minAmountForFreeDelivery) : null)
          : zone.minAmountForFreeDelivery,
        isActive: isActive !== undefined ? isActive : zone.isActive,
      },
    });

    return sendSuccess(res, "Delivery zone updated successfully", updated);
  },
};
