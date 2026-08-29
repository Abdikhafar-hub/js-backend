import {
  InventoryMovementType,
  StockAdjustmentStatus,
  StockAdjustmentType,
  StockIssueReportStatus
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { auditService } from "../../services/audit.service.js";
import { inventoryWriteService } from "../../services/inventory-write.service.js";
import type { AuthContext } from "../../types/auth.js";

const getAdjustmentWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
  };
};

const isPositiveAdjustment = (type: StockAdjustmentType) => type === StockAdjustmentType.FOUND_STOCK;

export const stockAdjustmentsService = {
  async list(auth: AuthContext, query: Record<string, any> = {}) {
    const where: any = getAdjustmentWhere(auth);
    if (query.branchId) { assertBranchAccess(auth, String(query.branchId)); where.branchId = String(query.branchId); }
    return prisma.stockAdjustment.findMany({
      where,
      include: {
        branch: true,
        items: {
          include: {
            productVariant: {
              include: {
                product: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async get(auth: AuthContext, id: string) {
    const adjustment = await prisma.stockAdjustment.findFirst({
      where: {
        id,
        ...getAdjustmentWhere(auth)
      },
      include: {
        branch: true,
        items: {
          include: {
            productVariant: {
              include: {
                product: true
              }
            },
            inventoryBatch: true
          }
        }
      }
    });

    if (!adjustment) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock adjustment not found", StatusCodes.NOT_FOUND);
    }

    return adjustment;
  },

  async create(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);

    const getDirection = (type: StockAdjustmentType, itemDirection: string) => {
      switch (type) {
        case "DAMAGE":
        case "LOSS":
        case "EXPIRY":
        case "INTERNAL_USE":
        case "SAMPLE_USAGE":
        case "TESTER_USAGE":
          return "DECREASE";
        case "FOUND_STOCK":
          return "INCREASE";
        case "DATA_CORRECTION":
        case "OTHER":
          if (itemDirection !== "INCREASE" && itemDirection !== "DECREASE") {
            throw new AppError(ERROR_CODES.BAD_REQUEST, `Invalid direction for type ${type}`, StatusCodes.BAD_REQUEST);
          }
          return itemDirection;
        default:
          throw new AppError(ERROR_CODES.BAD_REQUEST, `Unsupported adjustment type ${type}`, StatusCodes.BAD_REQUEST);
      }
    };

    return prisma.$transaction(async (tx) => {
      const count = await tx.stockAdjustment.count({
        where: { organizationId: auth.organizationId }
      });

      const adjustment = await tx.stockAdjustment.create({
        data: {
          organizationId: auth.organizationId,
          branchId: input.branchId,
          adjustmentNumber: `ADJ-${String(count + 1).padStart(6, "0")}`,
          adjustmentType: input.adjustmentType,
          status: StockAdjustmentStatus.DRAFT,
          createdById: auth.userId,
          sourceStockIssueId: input.sourceStockIssueId || null,
          reason: input.reason,
          notes: input.notes || null
        }
      });

      const branch = await tx.branch.findUnique({ where: { id: input.branchId } });

      for (const item of input.items) {
        const variant = await tx.productVariant.findFirstOrThrow({
          where: {
            id: item.productVariantId,
            organizationId: auth.organizationId
          }
        });

        // Enforce batch selection where tracked
        if (variant.batchTrackingEnabled && !item.inventoryBatchId) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Batch selection is required for product variant ${variant.sku} as batch tracking is enabled.`,
            StatusCodes.BAD_REQUEST
          );
        }

        // Fetch quantityBefore
        let quantityBefore = 0;
        if (item.inventoryBatchId) {
          const batchRecord = await tx.inventoryBatch.findUnique({
            where: { id: item.inventoryBatchId }
          });
          if (!batchRecord) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, `Inventory batch not found for ID: ${item.inventoryBatchId}`, StatusCodes.BAD_REQUEST);
          }
          quantityBefore = Number(batchRecord.quantityOnHand);
        } else {
          const balance = await tx.inventoryBalance.findUnique({
            where: {
              organizationId_branchId_productVariantId: {
                organizationId: auth.organizationId,
                branchId: input.branchId,
                productVariantId: item.productVariantId
              }
            }
          });
          quantityBefore = balance ? Number(balance.quantityOnHand) : 0;
        }

        // Resolve direction and quantityAfter
        const resolvedDirection = getDirection(input.adjustmentType, item.direction);
        const quantityAfter = resolvedDirection === "INCREASE"
          ? quantityBefore + item.quantity
          : quantityBefore - item.quantity;

        // Check stock-out
        if (resolvedDirection === "DECREASE" && !branch?.allowsNegativeStock && quantityBefore < item.quantity) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Insufficient stock for product variant ${variant.sku}. Available: ${quantityBefore}, Requested adjustment: ${item.quantity}`,
            StatusCodes.BAD_REQUEST
          );
        }

        // Snapshot unit cost
        let unitCostSnapshot = 0;
        if (item.inventoryBatchId) {
          const batchRecord = await tx.inventoryBatch.findUnique({
            where: { id: item.inventoryBatchId }
          });
          unitCostSnapshot = batchRecord ? Number(batchRecord.unitCost) : 0;
        } else {
          const balance = await tx.inventoryBalance.findUnique({
            where: {
              organizationId_branchId_productVariantId: {
                organizationId: auth.organizationId,
                branchId: input.branchId,
                productVariantId: item.productVariantId
              }
            }
          });
          unitCostSnapshot = balance ? Number(balance.averageUnitCost) : 0;
        }

        if (!unitCostSnapshot) {
          unitCostSnapshot = Number(variant.defaultCost);
        }

        const finalUnitCost = typeof item.unitCost === "number" ? item.unitCost : unitCostSnapshot;

        await tx.stockAdjustmentItem.create({
          data: {
            stockAdjustmentId: adjustment.id,
            productVariantId: item.productVariantId,
            inventoryBatchId: item.inventoryBatchId || null,
            direction: resolvedDirection,
            quantity: item.quantity,
            quantityBefore,
            quantityAfter,
            unitCost: finalUnitCost,
            unitCostSnapshot
          }
        });
      }

      await auditService.create(
        {
          organizationId: auth.organizationId,
          branchId: input.branchId,
          userId: auth.userId,
          action: "stock_adjustment.create",
          entityType: "StockAdjustment",
          entityId: adjustment.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          afterData: adjustment
        },
        tx
      );

      return this.get(auth, adjustment.id);
    });
  },

  async submit(auth: AuthContext, id: string, request: Request) {
    const adjustment = await this.get(auth, id);
    if (adjustment.status !== StockAdjustmentStatus.DRAFT) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only draft adjustments can be submitted", StatusCodes.BAD_REQUEST);
    }

    assertBranchAccess(auth, adjustment.branchId);

    return prisma.$transaction(async (tx) => {
      const items = await tx.stockAdjustmentItem.findMany({
        where: { stockAdjustmentId: adjustment.id },
        include: { productVariant: true }
      });

      const branch = await tx.branch.findUnique({ where: { id: adjustment.branchId } });

      for (const item of items) {
        // Enforce batch selection where tracked
        if (item.productVariant.batchTrackingEnabled && !item.inventoryBatchId) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Batch selection is required for product variant ${item.productVariant.sku} as batch tracking is enabled.`,
            StatusCodes.BAD_REQUEST
          );
        }

        // Fetch quantityBefore
        let quantityBefore = 0;
        if (item.inventoryBatchId) {
          const batchRecord = await tx.inventoryBatch.findUnique({
            where: { id: item.inventoryBatchId }
          });
          if (!batchRecord) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, `Inventory batch not found for ID: ${item.inventoryBatchId}`, StatusCodes.BAD_REQUEST);
          }
          quantityBefore = Number(batchRecord.quantityOnHand);
        } else {
          const balance = await tx.inventoryBalance.findUnique({
            where: {
              organizationId_branchId_productVariantId: {
                organizationId: auth.organizationId,
                branchId: adjustment.branchId,
                productVariantId: item.productVariantId
              }
            }
          });
          quantityBefore = balance ? Number(balance.quantityOnHand) : 0;
        }

        const quantityAfter = item.direction === "INCREASE"
          ? quantityBefore + Number(item.quantity)
          : quantityBefore - Number(item.quantity);

        // Check stock-out
        if (item.direction === "DECREASE" && !branch?.allowsNegativeStock && quantityBefore < Number(item.quantity)) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Insufficient stock for product variant ${item.productVariant.sku}. Available: ${quantityBefore}, Requested adjustment: ${item.quantity}`,
            StatusCodes.BAD_REQUEST
          );
        }

        // Update item with latest quantities
        await tx.stockAdjustmentItem.update({
          where: { id: item.id },
          data: {
            quantityBefore,
            quantityAfter
          }
        });
      }

      const updated = await tx.stockAdjustment.update({
        where: { id: adjustment.id },
        data: {
          status: StockAdjustmentStatus.SUBMITTED,
          submittedAt: new Date()
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: adjustment.branchId,
        userId: auth.userId,
        action: "stock_adjustment.submit",
        entityType: "StockAdjustment",
        entityId: adjustment.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: adjustment,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async approve(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    const adjustment = await this.get(auth, id);
    if (adjustment.status !== StockAdjustmentStatus.SUBMITTED) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only submitted adjustments can be approved", StatusCodes.BAD_REQUEST);
    }

    assertBranchAccess(auth, adjustment.branchId);

    if (adjustment.createdById === auth.userId) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Self-approval is not allowed", StatusCodes.FORBIDDEN);
    }

    if (auth.role === "BRANCH_MANAGER") {
      const totalValuationImpact = adjustment.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);
      if (totalValuationImpact > 50000) {
        throw new AppError(
          ERROR_CODES.ACCESS_DENIED,
          `Valuation impact of ${totalValuationImpact} exceeds branch manager approval threshold of 50,000. General Manager approval required.`,
          StatusCodes.FORBIDDEN
        );
      }
    }

    const updated = await prisma.stockAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: StockAdjustmentStatus.APPROVED,
        approvedById: auth.userId,
        approvedAt: new Date(),
        notes: input.notes || adjustment.notes
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: adjustment.branchId,
      userId: auth.userId,
      action: "stock_adjustment.approve",
      entityType: "StockAdjustment",
      entityId: adjustment.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: adjustment,
      afterData: updated
    });

    return updated;
  },

  async reject(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    const adjustment = await this.get(auth, id);
    if (adjustment.status !== StockAdjustmentStatus.SUBMITTED) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only submitted adjustments can be rejected", StatusCodes.BAD_REQUEST);
    }

    assertBranchAccess(auth, adjustment.branchId);

    const updated = await prisma.stockAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: StockAdjustmentStatus.REJECTED,
        rejectedById: auth.userId,
        rejectedAt: new Date(),
        rejectionReason: input.reason
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: adjustment.branchId,
      userId: auth.userId,
      action: "stock_adjustment.reject",
      entityType: "StockAdjustment",
      entityId: adjustment.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: adjustment,
      afterData: updated
    });

    return updated;
  },

  async post(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.findFirst({
        where: {
          id,
          ...getAdjustmentWhere(auth)
        },
        include: {
          items: {
            include: {
              productVariant: true
            }
          }
        }
      });

      if (!adjustment) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock adjustment not found", StatusCodes.NOT_FOUND);
      }

      assertBranchAccess(auth, adjustment.branchId);

      if (adjustment.status === StockAdjustmentStatus.POSTED) {
        throw new AppError(ERROR_CODES.DUPLICATE_IDEMPOTENCY_KEY, "Stock adjustment already posted", StatusCodes.CONFLICT);
      }

      if (adjustment.status !== StockAdjustmentStatus.APPROVED) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only approved adjustments can be posted", StatusCodes.BAD_REQUEST);
      }

      if (auth.role === "BRANCH_MANAGER") {
        const totalValuationImpact = adjustment.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);
        if (totalValuationImpact > 50000) {
          throw new AppError(
            ERROR_CODES.ACCESS_DENIED,
            `Posting failed. Valuation impact of ${totalValuationImpact} exceeds branch manager threshold.`,
            StatusCodes.FORBIDDEN
          );
        }
      }

      const branch = await tx.branch.findUnique({ where: { id: adjustment.branchId } });

      for (const item of adjustment.items) {
        // Concurrency protection: Lock balance row
        await inventoryWriteService.lockBalance(tx, adjustment.organizationId, adjustment.branchId, item.productVariantId);

        // Fetch current stock level under lock
        let quantityBefore = 0;
        if (item.inventoryBatchId) {
          const batchRecord = await tx.inventoryBatch.findUnique({
            where: { id: item.inventoryBatchId }
          });
          if (!batchRecord) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, `Inventory batch not found for ID: ${item.inventoryBatchId}`, StatusCodes.BAD_REQUEST);
          }
          quantityBefore = Number(batchRecord.quantityOnHand);
        } else {
          const balance = await tx.inventoryBalance.findUnique({
            where: {
              organizationId_branchId_productVariantId: {
                organizationId: adjustment.organizationId,
                branchId: adjustment.branchId,
                productVariantId: item.productVariantId
              }
            }
          });
          quantityBefore = balance ? Number(balance.quantityOnHand) : 0;
        }

        // Revalidate stock-out constraint under lock
        if (item.direction === "DECREASE" && !branch?.allowsNegativeStock && quantityBefore < Number(item.quantity)) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Insufficient stock for product variant ${item.productVariant.sku} during posting. Available: ${quantityBefore}, Requested adjustment: ${item.quantity}`,
            StatusCodes.BAD_REQUEST
          );
        }

        const quantityChange = item.direction === "INCREASE" ? Number(item.quantity) : -Number(item.quantity);

        await inventoryWriteService.adjustStock(tx, {
          organizationId: adjustment.organizationId,
          branchId: adjustment.branchId,
          productVariantId: item.productVariantId,
          quantity: quantityChange,
          unitCost: Number(item.unitCost),
          movementType: item.direction === "INCREASE"
            ? InventoryMovementType.STOCK_ADJUSTMENT_IN
            : InventoryMovementType.STOCK_ADJUSTMENT_OUT,
          referenceType: "StockAdjustmentItem",
          referenceId: item.id,
          performedById: auth.userId,
          notes: `${adjustment.adjustmentType}: ${adjustment.reason}`,
          inventoryBatchId: item.inventoryBatchId || undefined
        });

        // Record locked before/after quantities
        const quantityAfter = quantityBefore + quantityChange;
        await tx.stockAdjustmentItem.update({
          where: { id: item.id },
          data: {
            quantityBefore,
            quantityAfter
          }
        });
      }

      const posted = await tx.stockAdjustment.update({
        where: { id: adjustment.id },
        data: {
          status: StockAdjustmentStatus.POSTED,
          postedById: auth.userId,
          postedAt: new Date()
        }
      });

      if (adjustment.sourceStockIssueId) {
        await tx.stockIssueReport.update({
          where: { id: adjustment.sourceStockIssueId },
          data: {
            status: StockIssueReportStatus.CLOSED
          }
        });
      }

      await auditService.create(
        {
          organizationId: auth.organizationId,
          branchId: adjustment.branchId,
          userId: auth.userId,
          action: "stock_adjustment.post",
          entityType: "StockAdjustment",
          entityId: adjustment.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          beforeData: adjustment,
          afterData: posted
        },
        tx
      );

      return posted;
    });
  },

  async cancel(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    const adjustment = await this.get(auth, id);
    if (adjustment.status === StockAdjustmentStatus.POSTED) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Posted adjustments cannot be cancelled", StatusCodes.BAD_REQUEST);
    }

    assertBranchAccess(auth, adjustment.branchId);

    const updated = await prisma.stockAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: StockAdjustmentStatus.CANCELLED,
        notes: input.reason ? `${adjustment.notes || ""}\nCancelled: ${input.reason}`.trim() : adjustment.notes
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: adjustment.branchId,
      userId: auth.userId,
      action: "stock_adjustment.cancel",
      entityType: "StockAdjustment",
      entityId: adjustment.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: adjustment,
      afterData: updated
    });

    return updated;
  }
};
