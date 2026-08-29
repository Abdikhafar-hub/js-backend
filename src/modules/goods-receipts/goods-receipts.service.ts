import { Prisma, GoodsReceiptStatus, PurchaseOrderStatus, SupplierLedgerEntryType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { inventoryWriteService } from "../../services/inventory-write.service.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";

const getReceiptWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
  };
};

export const goodsReceiptsService = {
  async listEligiblePurchaseOrders(auth: AuthContext, query: Record<string, any> = {}) {
    const scope = buildUserScope(auth);
    if (query.branchId) assertBranchAccess(auth, String(query.branchId));
    return prisma.purchaseOrder.findMany({
      where: {
        organizationId: auth.organizationId,
        destinationBranchId: query.branchId ? String(query.branchId) : scope.branchIds ? { in: scope.branchIds } : undefined,
        status: { in: ["APPROVED", "SENT_TO_SUPPLIER", "PARTIALLY_RECEIVED"] }
      },
      include: { supplier: true, destinationBranch: true, items: true },
      orderBy: { createdAt: "desc" }
    });
  },
  async list(auth: AuthContext, query: Record<string, any> = {}) {
    const where: any = getReceiptWhere(auth);
    if (query.branchId) { assertBranchAccess(auth, String(query.branchId)); where.branchId = String(query.branchId); }
    return prisma.goodsReceipt.findMany({
      where,
      include: {
        branch: true,
        supplier: true,
        purchaseOrder: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async bootstrapFromPurchaseOrder(auth: AuthContext, purchaseOrderId: string) {
    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        organizationId: auth.organizationId
      },
      include: {
        supplier: true,
        destinationBranch: true,
        shipments: {
          include: {
            costs: true
          },
          orderBy: { createdAt: "desc" }
        },
        items: {
          include: {
            productVariant: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });

    if (!po) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Purchase order not found", StatusCodes.NOT_FOUND);
    }
    assertBranchAccess(auth, po.destinationBranchId);

    const items = po.items
      .map((item) => {
        const ordered = Number(item.quantityOrdered);
        const received = Number(item.quantityReceived);
        const remaining = Math.max(ordered - received, 0);
        return {
          purchaseOrderItemId: item.id,
          productVariantId: item.productVariantId,
          quantityOrdered: ordered,
          quantityPreviouslyReceived: received,
          quantityRemaining: remaining,
          quantityRejected: Number(item.quantityRejected),
          unitCost: Number(item.unitCost),
          productVariant: item.productVariant
        };
      })
      .filter((item) => item.quantityRemaining > 0);

    return {
      purchaseOrder: po,
      supplier: po.supplier,
      branch: po.destinationBranch,
      openShipments: po.shipments.filter((shipment) => shipment.status !== "RECEIVED" && shipment.status !== "CANCELLED"),
      items
    };
  },

  async get(auth: AuthContext, id: string) {
    const receipt = await prisma.goodsReceipt.findFirst({
      where: { id, ...getReceiptWhere(auth) },
      include: {
        branch: true,
        supplier: true,
        purchaseOrder: true,
        shipment: true,
        items: {
          include: {
            productVariant: {
              include: { product: true }
            }
          }
        }
      }
    });

    if (!receipt) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Goods receipt not found", StatusCodes.NOT_FOUND);
    }

    return receipt;
  },

  async create(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);

    return prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findFirst({
        where: {
          id: input.purchaseOrderId,
          organizationId: auth.organizationId
        },
        include: {
          items: true
        }
      });

      if (!purchaseOrder) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Purchase order not found", StatusCodes.NOT_FOUND);
      }

      if (purchaseOrder.destinationBranchId !== input.branchId) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Receiving branch must match the purchase order destination", StatusCodes.BAD_REQUEST);
      }

      if (purchaseOrder.supplierId !== input.supplierId) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Supplier must match the purchase order supplier", StatusCodes.BAD_REQUEST);
      }

      if (input.shipmentId) {
        const shipment = await tx.importShipment.findFirst({
          where: {
            id: input.shipmentId,
            organizationId: auth.organizationId,
            purchaseOrderId: purchaseOrder.id
          }
        });

        if (!shipment) {
          throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found for the selected purchase order", StatusCodes.NOT_FOUND);
        }
      }

      const count = await tx.goodsReceipt.count({
        where: { organizationId: auth.organizationId }
      });
      const receiptNumber = `GRN-${(count + 1).toString().padStart(6, "0")}`;

      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId: auth.organizationId,
          branchId: input.branchId,
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId,
          shipmentId: input.shipmentId || null,
          receiptNumber,
          supplierInvoiceNumber: input.supplierInvoiceNumber || null,
          receivedById: auth.userId,
          receivedAt: new Date(input.receivedAt),
          status: GoodsReceiptStatus.DRAFT,
          notes: input.notes || null
        }
      });

      for (const item of input.items) {
        const poItem = purchaseOrder.items.find((candidate) => candidate.id === item.purchaseOrderItemId);

        if (!poItem) {
          throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Purchase order item not found", StatusCodes.NOT_FOUND);
        }

        const ordered = Number(poItem.quantityOrdered);
        const previouslyReceived = Number(poItem.quantityReceived);
        const remaining = Math.max(ordered - previouslyReceived, 0);

        if (item.quantityReceived > remaining) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            "Received quantity cannot exceed the remaining receivable quantity",
            StatusCodes.BAD_REQUEST
          );
        }

        if (item.quantityAccepted + item.quantityRejected > item.quantityReceived) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            "Accepted plus rejected quantity cannot exceed received quantity",
            StatusCodes.BAD_REQUEST
          );
        }

        // Look up landed cost allocation if shipment is linked
        let allocatedLandedCost = 0;
        if (input.shipmentId) {
          const allocation = await tx.importShipmentItemAllocation.findFirst({
            where: {
              shipmentId: input.shipmentId,
              productVariantId: item.productVariantId
            }
          });
          if (allocation) {
            // Allocate proportionally based on expected quantity
            allocatedLandedCost = Number(allocation.allocatedAmount);
          }
        }

        const landedUnitCost = item.unitCost + (item.quantityExpected > 0 ? (allocatedLandedCost / item.quantityExpected) : 0);
        const lineTotal = item.quantityAccepted * landedUnitCost;

        await tx.goodsReceiptItem.create({
          data: {
            goodsReceiptId: receipt.id,
            purchaseOrderItemId: item.purchaseOrderItemId,
            productVariantId: item.productVariantId,
            quantityExpected: item.quantityExpected,
            quantityReceived: item.quantityReceived,
            quantityAccepted: item.quantityAccepted,
            quantityRejected: item.quantityRejected || 0,
            rejectionReason: item.rejectionReason || null,
            batchNumber: item.batchNumber || null,
            manufactureDate: item.manufactureDate ? new Date(item.manufactureDate) : null,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            unitCost: item.unitCost,
            allocatedLandedCost,
            landedUnitCost,
            lineTotal
          }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: input.branchId,
        userId: auth.userId,
        action: "goods_receipt.create",
        entityType: "GoodsReceipt",
        entityId: receipt.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: receipt
      }, tx);

      return receipt;
    });
  },

  async post(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.findFirst({
        where: { id, organizationId: auth.organizationId },
        include: {
          items: true,
          purchaseOrder: {
            include: {
              items: true
            }
          }
        }
      });

      if (!receipt) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Goods receipt not found", StatusCodes.NOT_FOUND);
      }
      assertBranchAccess(auth, receipt.branchId);

      if (receipt.status === GoodsReceiptStatus.POSTED) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Goods receipt has already been posted", StatusCodes.BAD_REQUEST);
      }

      let totalAcceptedValue = 0;

      for (const item of receipt.items) {
        const qtyAccepted = Number(item.quantityAccepted);

        if (qtyAccepted > 0) {
          // Increment stock using central write engine
          await inventoryWriteService.receiveStock(tx, {
            organizationId: receipt.organizationId,
            branchId: receipt.branchId,
            productVariantId: item.productVariantId,
            quantity: qtyAccepted,
            unitCost: Number(item.unitCost),
            landedUnitCost: Number(item.landedUnitCost),
            batchNumber: item.batchNumber || undefined,
            manufactureDate: item.manufactureDate || undefined,
            expiryDate: item.expiryDate || undefined,
            referenceType: "GoodsReceiptItem",
            referenceId: item.id,
            performedById: auth.userId
          });

          totalAcceptedValue += qtyAccepted * Number(item.landedUnitCost);
        }

        // Update purchase order item quantities received/rejected
        await tx.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId },
          data: {
            quantityReceived: { increment: Number(item.quantityReceived) },
            quantityRejected: { increment: Number(item.quantityRejected) }
          }
        });
      }

      // Re-evaluate Purchase Order status
      const updatedPO = await tx.purchaseOrder.findUnique({
        where: { id: receipt.purchaseOrderId },
        include: { items: true }
      });

      if (updatedPO) {
        let allReceived = true;
        let anyReceived = false;

        for (const poItem of updatedPO.items) {
          const received = Number(poItem.quantityReceived);
          const ordered = Number(poItem.quantityOrdered);

          if (received < ordered) {
            allReceived = false;
          }
          if (received > 0) {
            anyReceived = true;
          }
        }

        const finalPOStatus = allReceived
          ? PurchaseOrderStatus.FULLY_RECEIVED
          : anyReceived
          ? PurchaseOrderStatus.PARTIALLY_RECEIVED
          : PurchaseOrderStatus.SENT_TO_SUPPLIER;

        await tx.purchaseOrder.update({
          where: { id: updatedPO.id },
          data: { status: finalPOStatus }
        });
      }

      // Update Supplier balance (we owe them more)
      const supplier = await tx.supplier.findUnique({
        where: { id: receipt.supplierId }
      });

      if (supplier) {
        const balanceBefore = Number(supplier.currentBalance);
        const balanceAfter = balanceBefore + totalAcceptedValue;

        const ledger = await tx.supplierLedgerEntry.create({
          data: {
            supplierId: supplier.id,
            entryType: SupplierLedgerEntryType.PURCHASE_INVOICE,
            amount: totalAcceptedValue,
            balanceBefore,
            balanceAfter,
            referenceType: "GoodsReceipt",
            referenceId: receipt.id,
            notes: `Purchase receipt GRN: ${receipt.receiptNumber}`
          }
        });

        await tx.supplier.update({
          where: { id: supplier.id },
          data: {
            currentBalance: balanceAfter
          }
        });
      }

      // Update Goods Receipt status
      const posted = await tx.goodsReceipt.update({
        where: { id: receipt.id },
        data: {
          status: GoodsReceiptStatus.POSTED,
          postedAt: new Date(),
          postedById: auth.userId
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: receipt.branchId,
        userId: auth.userId,
        action: "goods_receipt.post",
        entityType: "GoodsReceipt",
        entityId: receipt.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: receipt,
        afterData: posted
      }, tx);

      return posted;
    });
  }
};
