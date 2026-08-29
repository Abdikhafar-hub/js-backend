import { Prisma, RequisitionStatus, RequisitionPriority, PurchaseOrderStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";

const getRequisitionWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { requestingBranchId: { in: scope.branchIds } } : {})
  };
};

const getPOWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { destinationBranchId: { in: scope.branchIds } } : {})
  };
};

const buildNextPurchaseOrderNumber = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const latest = await tx.purchaseOrder.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: { purchaseOrderNumber: true }
  });

  const latestSequence = latest?.purchaseOrderNumber
    ? Number(latest.purchaseOrderNumber.replace(/^PO-/, ""))
    : 0;

  return `PO-${String((Number.isFinite(latestSequence) ? latestSequence : 0) + 1).padStart(6, "0")}`;
};

const ensureSupplierAndDestination = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  input: { supplierId: string; destinationBranchId: string }
) => {
  const [supplier, destinationBranch] = await Promise.all([
    tx.supplier.findFirst({
      where: {
        id: input.supplierId,
        organizationId: auth.organizationId
      }
    }),
    tx.branch.findFirst({
      where: {
        id: input.destinationBranchId,
        organizationId: auth.organizationId
      }
    })
  ]);

  if (!supplier) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Supplier is invalid for this organization", StatusCodes.BAD_REQUEST);
  }

  if (!destinationBranch) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Destination branch is invalid for this organization", StatusCodes.BAD_REQUEST);
  }

  return { supplier, destinationBranch };
};

export const procurementService = {
  // ==========================================
  // REQUISITIONS
  // ==========================================

  async listRequisitions(auth: AuthContext, query: Record<string, any> = {}) {
    const where: any = getRequisitionWhere(auth);
    if (query.branchId) { assertBranchAccess(auth, String(query.branchId)); where.requestingBranchId = String(query.branchId); }
    return prisma.purchaseRequisition.findMany({
      where,
      include: {
        requestingBranch: true,
        requestedBy: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getRequisition(auth: AuthContext, id: string) {
    const requisition = await prisma.purchaseRequisition.findFirst({
      where: { id, ...getRequisitionWhere(auth) },
      include: {
        requestingBranch: true,
        requestedBy: true,
        approvedBy: true,
        rejectedBy: true,
        items: {
          include: {
            productVariant: true
          }
        }
      }
    });

    if (!requisition) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Requisition not found", StatusCodes.NOT_FOUND);
    }

    return requisition;
  },

  async createRequisition(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.requestingBranchId);
    return prisma.$transaction(async (tx) => {
      const count = await tx.purchaseRequisition.count({
        where: { organizationId: auth.organizationId }
      });
      const requisitionNumber = `PR-${(count + 1).toString().padStart(6, "0")}`;

      const requisition = await tx.purchaseRequisition.create({
        data: {
          organizationId: auth.organizationId,
          requestingBranchId: input.requestingBranchId,
          requisitionNumber,
          requestedById: auth.userId,
          priority: input.priority || RequisitionPriority.MEDIUM,
          reason: input.reason || null,
          status: RequisitionStatus.DRAFT
        }
      });

      for (const item of input.items) {
        // Find stock levels
        const branchStock = await tx.inventoryBalance.findFirst({
          where: {
            organizationId: auth.organizationId,
            branchId: input.requestingBranchId,
            productVariantId: item.productVariantId
          }
        });

        const globalStockAgg = await tx.inventoryBalance.aggregate({
          where: {
            organizationId: auth.organizationId,
            productVariantId: item.productVariantId
          },
          _sum: {
            quantityOnHand: true
          }
        });

        await tx.purchaseRequisitionItem.create({
          data: {
            requisitionId: requisition.id,
            productVariantId: item.productVariantId,
            quantityRequested: item.quantityRequested,
            currentBranchStock: branchStock ? Number(branchStock.quantityOnHand) : 0,
            currentOrganizationStock: globalStockAgg._sum.quantityOnHand ? Number(globalStockAgg._sum.quantityOnHand) : 0,
            notes: item.notes || null
          }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: input.requestingBranchId,
        userId: auth.userId,
        action: "requisition.create",
        entityType: "PurchaseRequisition",
        entityId: requisition.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: requisition
      }, tx);

      return requisition;
    });
  },

  async submitRequisition(auth: AuthContext, id: string, request: Request) {
    const requisition = await this.getRequisition(auth, id);
    if (requisition.status !== RequisitionStatus.DRAFT) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Only draft requisitions can be submitted", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.purchaseRequisition.update({
      where: { id: requisition.id },
      data: {
        status: RequisitionStatus.SUBMITTED,
        submittedAt: new Date()
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: requisition.requestingBranchId,
      userId: auth.userId,
      action: "requisition.submit",
      entityType: "PurchaseRequisition",
      entityId: requisition.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: requisition,
      afterData: updated
    });

    return updated;
  },

  async approveRequisition(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const requisition = await tx.purchaseRequisition.findFirst({
        where: { id, organizationId: auth.organizationId },
        include: { items: true }
      });

      if (!requisition || requisition.status !== RequisitionStatus.SUBMITTED) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Requisition not found or not in submitted state", StatusCodes.BAD_REQUEST);
      }

      let allApprovedZero = true;
      let hasPartial = false;

      for (const approvalItem of input.items) {
        const dbItem = requisition.items.find(item => item.id === approvalItem.itemId);
        if (!dbItem) continue;

        const approvedQty = Number(approvalItem.quantityApproved);
        if (approvedQty > 0) allApprovedZero = false;
        if (approvedQty < Number(dbItem.quantityRequested)) hasPartial = true;

        await tx.purchaseRequisitionItem.update({
          where: { id: dbItem.id },
          data: {
            quantityApproved: approvedQty
          }
        });
      }

      const finalStatus = allApprovedZero
        ? RequisitionStatus.REJECTED
        : hasPartial
        ? RequisitionStatus.PARTIALLY_APPROVED
        : RequisitionStatus.APPROVED;

      const updated = await tx.purchaseRequisition.update({
        where: { id: requisition.id },
        data: {
          status: finalStatus,
          approvedById: auth.userId,
          approvedAt: new Date(),
          ...(finalStatus === RequisitionStatus.REJECTED ? { rejectedById: auth.userId, rejectedAt: new Date(), rejectionReason: "All items approved with 0 quantity" } : {})
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: requisition.requestingBranchId,
        userId: auth.userId,
        action: "requisition.approve",
        entityType: "PurchaseRequisition",
        entityId: requisition.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: requisition,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async rejectRequisition(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    const requisition = await this.getRequisition(auth, id);
    if (requisition.status !== RequisitionStatus.SUBMITTED) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Only submitted requisitions can be rejected", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.purchaseRequisition.update({
      where: { id: requisition.id },
      data: {
        status: RequisitionStatus.REJECTED,
        rejectedById: auth.userId,
        rejectedAt: new Date(),
        rejectionReason: input.reason
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: requisition.requestingBranchId,
      userId: auth.userId,
      action: "requisition.reject",
      entityType: "PurchaseRequisition",
      entityId: requisition.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: requisition,
      afterData: updated
    });

    return updated;
  },

  // ==========================================
  // PURCHASE ORDERS
  // ==========================================

  async listPOs(auth: AuthContext) {
    return prisma.purchaseOrder.findMany({
      where: getPOWhere(auth),
      include: {
        supplier: true,
        destinationBranch: true,
        createdBy: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getPO(auth: AuthContext, id: string) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id, ...getPOWhere(auth) },
      include: {
        supplier: true,
        destinationBranch: true,
        createdBy: true,
        submittedBy: true,
        approvedBy: true,
        items: {
          include: {
            productVariant: true
          }
        },
        approvals: {
          include: {
            approvedBy: true
          }
        }
      }
    });

    if (!po) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Purchase order not found", StatusCodes.NOT_FOUND);
    }

    return po;
  },

  async createPO(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const purchaseOrderNumber = await buildNextPurchaseOrderNumber(tx, auth.organizationId);
      await ensureSupplierAndDestination(tx, auth, {
        supplierId: input.supplierId,
        destinationBranchId: input.destinationBranchId
      });

      // Calculate totals
      let subtotal = 0;
      for (const item of input.items) {
        const itemSubtotal = item.quantityOrdered * item.unitCost;
        const itemTotal = itemSubtotal - (item.discountAmount || 0) + (item.taxAmount || 0);
        subtotal += itemSubtotal;
      }

      const totalAmount = subtotal - (input.discountAmount || 0) + (input.taxAmount || 0);

      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: auth.organizationId,
          supplierId: input.supplierId,
          destinationBranchId: input.destinationBranchId,
          purchaseOrderNumber,
          sourceRequisitionId: input.sourceRequisitionId || null,
          currencyCode: input.currencyCode || "KES",
          exchangeRate: input.exchangeRate || 1.0,
          subtotal,
          discountAmount: input.discountAmount || 0,
          taxAmount: input.taxAmount || 0,
          totalAmount,
          paymentTermsDays: input.paymentTermsDays || 0,
          expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
          status: PurchaseOrderStatus.DRAFT,
          createdById: auth.userId
        }
      });

      for (const item of input.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: item.productVariantId, organizationId: auth.organizationId },
          include: { product: true }
        });

        if (!variant) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, `Product variant ${item.productVariantId} not found`, StatusCodes.BAD_REQUEST);
        }

        const itemSubtotal = item.quantityOrdered * item.unitCost;
        const lineTotal = itemSubtotal - (item.discountAmount || 0) + (item.taxAmount || 0);

        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: po.id,
            productVariantId: item.productVariantId,
            supplierSkuSnapshot: variant.sku,
            productNameSnapshot: variant.product.name,
            quantityOrdered: item.quantityOrdered,
            quantityReceived: 0,
            quantityRejected: 0,
            unitCost: item.unitCost,
            discountAmount: item.discountAmount || 0,
            taxAmount: item.taxAmount || 0,
            lineTotal
          }
        });
      }

      if (input.sourceRequisitionId) {
        await tx.purchaseRequisition.update({
          where: { id: input.sourceRequisitionId },
          data: {
            status: RequisitionStatus.CONVERTED_TO_PURCHASE_ORDER,
            convertedPurchaseOrderId: po.id
          }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: input.destinationBranchId,
        userId: auth.userId,
        action: "po.create",
        entityType: "PurchaseOrder",
        entityId: po.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: po
      }, tx);

      return po;
    });
  },

  async convertRequisitionToPO(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const requisition = await tx.purchaseRequisition.findFirst({
        where: {
          id,
          organizationId: auth.organizationId
        },
        include: {
          items: {
            include: {
              productVariant: {
                include: { product: true }
              }
            }
          }
        }
      });

      if (!requisition) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Requisition not found", StatusCodes.NOT_FOUND);
      }

      if (
        requisition.status !== RequisitionStatus.APPROVED &&
        requisition.status !== RequisitionStatus.PARTIALLY_APPROVED
      ) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only approved requisitions can be converted", StatusCodes.BAD_REQUEST);
      }

      if (requisition.convertedPurchaseOrderId) {
        throw new AppError(ERROR_CODES.DUPLICATE_IDEMPOTENCY_KEY, "This requisition has already been converted", StatusCodes.CONFLICT);
      }

      const approvedItems = requisition.items.filter((item) => Number(item.quantityApproved) > 0);
      if (approvedItems.length === 0) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "At least one approved item is required", StatusCodes.BAD_REQUEST);
      }

      await ensureSupplierAndDestination(tx, auth, {
        supplierId: input.supplierId,
        destinationBranchId: input.destinationBranchId
      });

      const inputByItemId = new Map(
        (input.items as Array<Record<string, any>>).map((item) => [item.itemId, item])
      );

      for (const approvedItem of approvedItems) {
        const convertedLine = inputByItemId.get(approvedItem.id);
        if (!convertedLine) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Approved requisition item ${approvedItem.id} is missing from the conversion payload`,
            StatusCodes.BAD_REQUEST
          );
        }
      }

      const purchaseOrderNumber = await buildNextPurchaseOrderNumber(tx, auth.organizationId);

      const poLines = approvedItems.map((item) => {
        const pricing = inputByItemId.get(item.id)!;
        const quantityOrdered = Number(item.quantityApproved);
        const unitCost = Number(pricing.unitCost);
        const discountAmount = Number(pricing.discountAmount || 0);
        const taxAmount = Number(pricing.taxAmount || 0);
        const subtotal = quantityOrdered * unitCost;
        const lineTotal = subtotal - discountAmount + taxAmount;

        return {
          requisitionItem: item,
          quantityOrdered,
          unitCost,
          discountAmount,
          taxAmount,
          lineTotal,
          notes: pricing.notes || item.notes || null
        };
      });

      const subtotal = poLines.reduce((sum, item) => sum + (item.quantityOrdered * item.unitCost), 0);
      const totalAmount = subtotal - Number(input.discountAmount || 0) + Number(input.taxAmount || 0);

      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: auth.organizationId,
          supplierId: input.supplierId,
          destinationBranchId: input.destinationBranchId,
          purchaseOrderNumber,
          sourceRequisitionId: requisition.id,
          currencyCode: input.currencyCode || "KES",
          exchangeRate: input.exchangeRate || 1.0,
          subtotal,
          discountAmount: input.discountAmount || 0,
          taxAmount: input.taxAmount || 0,
          totalAmount,
          paymentTermsDays: input.paymentTermsDays || 0,
          expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
          status: PurchaseOrderStatus.DRAFT,
          createdById: auth.userId
        }
      });

      for (const line of poLines) {
        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: po.id,
            productVariantId: line.requisitionItem.productVariantId,
            supplierSkuSnapshot: line.requisitionItem.productVariant.sku,
            productNameSnapshot: line.requisitionItem.productVariant.product.name,
            quantityOrdered: line.quantityOrdered,
            quantityReceived: 0,
            quantityRejected: 0,
            unitCost: line.unitCost,
            discountAmount: line.discountAmount,
            taxAmount: line.taxAmount,
            lineTotal: line.lineTotal,
            notes: line.notes
          }
        });
      }

      const updatedRequisition = await tx.purchaseRequisition.update({
        where: { id: requisition.id },
        data: {
          status: RequisitionStatus.CONVERTED_TO_PURCHASE_ORDER,
          convertedPurchaseOrderId: po.id
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: requisition.requestingBranchId,
        userId: auth.userId,
        action: "requisition.convert_to_po",
        entityType: "PurchaseOrder",
        entityId: po.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: requisition,
        afterData: {
          purchaseOrder: po,
          requisition: updatedRequisition
        },
        metadata: {
          sourceRequisitionId: requisition.id
        }
      }, tx);

      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: {
          supplier: true,
          destinationBranch: true,
          createdBy: true,
          items: {
            include: {
              productVariant: true
            }
          }
        }
      });
    });
  },

  async submitPO(auth: AuthContext, id: string, request: Request) {
    const po = await this.getPO(auth, id);
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Only draft POs can be submitted", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: PurchaseOrderStatus.PENDING_APPROVAL,
        submittedById: auth.userId,
        submittedAt: new Date()
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: po.destinationBranchId,
      userId: auth.userId,
      action: "po.submit",
      entityType: "PurchaseOrder",
      entityId: po.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: po,
      afterData: updated
    });

    return updated;
  },

  async approvePO(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, organizationId: auth.organizationId }
      });

      if (!po || po.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "PO not found or not in pending approval state", StatusCodes.BAD_REQUEST);
      }

      const updated = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: PurchaseOrderStatus.APPROVED,
          approvedById: auth.userId,
          approvedAt: new Date()
        }
      });

      await tx.purchaseOrderApproval.create({
        data: {
          purchaseOrderId: po.id,
          approvedById: auth.userId,
          status: "APPROVED",
          notes: input.notes || "PO approved by GM"
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: po.destinationBranchId,
        userId: auth.userId,
        action: "po.approve",
        entityType: "PurchaseOrder",
        entityId: po.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: po,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async sendToSupplier(auth: AuthContext, id: string, request: Request) {
    const po = await this.getPO(auth, id);
    if (po.status !== PurchaseOrderStatus.APPROVED) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Only approved POs can be sent to suppliers", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: PurchaseOrderStatus.SENT_TO_SUPPLIER,
        sentAt: new Date()
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: po.destinationBranchId,
      userId: auth.userId,
      action: "po.send_to_supplier",
      entityType: "PurchaseOrder",
      entityId: po.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: po,
      afterData: updated
    });

    return updated;
  },

  async cancelPO(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    const po = await this.getPO(auth, id);
    if (
      po.status === PurchaseOrderStatus.FULLY_RECEIVED ||
      po.status === PurchaseOrderStatus.CLOSED ||
      po.status === PurchaseOrderStatus.CANCELLED
    ) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "This purchase order cannot be cancelled", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: PurchaseOrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: input.reason || "Cancelled by user"
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: po.destinationBranchId,
      userId: auth.userId,
      action: "po.cancel",
      entityType: "PurchaseOrder",
      entityId: po.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: po,
      afterData: updated
    });

    return updated;
  }
};
