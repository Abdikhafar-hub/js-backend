import { Prisma, StockCountStatus, StockCountType, InventoryMovementType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { inventoryWriteService } from "../../services/inventory-write.service.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";

const getCountWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
  };
};

export const countsService = {
  async list(auth: AuthContext, query: Record<string, any> = {}) {
    const where: any = getCountWhere(auth);
    if (query.branchId) {
      assertBranchAccess(auth, String(query.branchId));
      where.branchId = String(query.branchId);
    }
    return prisma.stockCount.findMany({
      where,
      include: {
        branch: true,
        assignments: {
          include: {
            user: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async get(auth: AuthContext, id: string) {
    const count = await prisma.stockCount.findFirst({
      where: { id, ...getCountWhere(auth) },
      include: {
        branch: true,
        assignments: {
          include: {
            user: true
          }
        },
        items: {
          include: {
            productVariant: {
              include: { product: true }
            }
          }
        }
      }
    });

    if (!count) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock count not found", StatusCodes.NOT_FOUND);
    }

    // Response shaping for blind count
    const isManager = auth.role === "GENERAL_MANAGER" || auth.role === "BRANCH_MANAGER";
    if (count.blindCount && !isManager && count.status !== StockCountStatus.APPROVED && count.status !== StockCountStatus.POSTED) {
      count.items = count.items.map((item) => ({
        ...item,
        expectedQuantity: new Prisma.Decimal(0)
      })) as any;
    }

    return count;
  },

  async create(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);

    return prisma.$transaction(async (tx) => {
      // Resolve active variants depending on scope
      let variants: any[] = [];
      const baseWhere = {
        organizationId: auth.organizationId,
        status: "ACTIVE" as any,
        product: { isActive: true }
      };

      if (input.countType === StockCountType.FULL) {
        variants = await tx.productVariant.findMany({
          where: baseWhere
        });
      } else if (input.countType === StockCountType.CATEGORY) {
        if (!input.categoryId) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Category is required for CATEGORY count type", StatusCodes.BAD_REQUEST);
        }
        variants = await tx.productVariant.findMany({
          where: {
            ...baseWhere,
            product: {
              isActive: true,
              categoryId: input.categoryId
            }
          }
        });
      } else if (input.countType === StockCountType.BRAND) {
        if (!input.brandId) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Brand is required for BRAND count type", StatusCodes.BAD_REQUEST);
        }
        variants = await tx.productVariant.findMany({
          where: {
            ...baseWhere,
            product: {
              isActive: true,
              brandId: input.brandId
            }
          }
        });
      } else if (input.countType === StockCountType.SPOT || input.countType === StockCountType.CYCLE) {
        // Spotlight manually selected or specific list of variants
        if (!input.productVariantIds || input.productVariantIds.length === 0) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "At least one product variant must be selected for SPOT/CYCLE counts", StatusCodes.BAD_REQUEST);
        }
        variants = await tx.productVariant.findMany({
          where: {
            ...baseWhere,
            id: { in: input.productVariantIds }
          }
        });
      }

      if (variants.length === 0) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "No active product variants found matching the selected scope", StatusCodes.BAD_REQUEST);
      }

      const countIndex = await tx.stockCount.count({
        where: { organizationId: auth.organizationId }
      });
      const countNumber = `CNT-${(countIndex + 1).toString().padStart(6, "0")}`;

      const status = input.scheduledAt ? StockCountStatus.SCHEDULED : StockCountStatus.DRAFT;

      const stockCount = await tx.stockCount.create({
        data: {
          organizationId: auth.organizationId,
          branchId: input.branchId,
          countNumber,
          countType: input.countType,
          status,
          notes: input.notes || null,
          createdById: auth.userId!,
          blindCount: input.blindCount || false,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null
        }
      });

      // Generate stock count lines with snapshots of expected quantities
      for (const variant of variants) {
        const balance = await tx.inventoryBalance.findFirst({
          where: {
            organizationId: auth.organizationId,
            branchId: input.branchId,
            productVariantId: variant.id
          }
        });
        const systemQuantity = balance ? Number(balance.quantityOnHand) : 0;

        await tx.stockCountItem.create({
          data: {
            stockCountId: stockCount.id,
            productVariantId: variant.id,
            expectedQuantity: systemQuantity,
            countedQuantity: null,
            firstCountedQuantity: null,
            recountQuantity: null,
            finalQuantity: null,
            varianceQuantity: null,
            varianceValue: null,
            status: "UNCOUNTED"
          }
        });
      }

      // Add assignments if provided
      if (input.assignedUserIds && input.assignedUserIds.length > 0) {
        for (const userId of input.assignedUserIds) {
          await tx.stockCountAssignment.create({
            data: {
              stockCountId: stockCount.id,
              userId,
              assignedById: auth.userId!
            }
          });
        }
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: input.branchId,
        userId: auth.userId,
        action: "stock_count.create",
        entityType: "StockCount",
        entityId: stockCount.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: stockCount
      }, tx);

      return stockCount;
    });
  },

  async updateItems(auth: AuthContext, id: string, items: any[], request: Request) {
    const count = await prisma.stockCount.findFirst({
      where: { id, ...getCountWhere(auth) },
      include: { assignments: true }
    });

    if (!count) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock count not found", StatusCodes.NOT_FOUND);
    }

    if (count.status === StockCountStatus.POSTED || count.status === StockCountStatus.CANCELLED) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Cannot update items on a posted or cancelled count", StatusCodes.CONFLICT);
    }

    const isManager = auth.role === "GENERAL_MANAGER" || auth.role === "BRANCH_MANAGER";
    const isAssigned = count.assignments.some((a) => a.userId === auth.userId);

    if (!isManager && !isAssigned) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "You are not assigned to perform counts on this stock sheet", StatusCodes.FORBIDDEN);
    }

    return prisma.$transaction(async (tx) => {
      // Auto transition to IN_PROGRESS if starting count from draft/scheduled
      if (count.status === StockCountStatus.DRAFT || count.status === StockCountStatus.SCHEDULED) {
        await tx.stockCount.update({
          where: { id },
          data: {
            status: StockCountStatus.IN_PROGRESS,
            startedAt: new Date(),
            frozenAt: new Date()
          }
        });
      }

      for (const itemInput of items) {
        const item = await tx.stockCountItem.findUnique({
          where: { id: itemInput.id }
        });

        if (!item || item.stockCountId !== id) continue;

        const isRecountItem = item.status === "RECOUNT_REQUIRED";
        const countedQty = itemInput.countedQuantity !== undefined && itemInput.countedQuantity !== null ? new Prisma.Decimal(itemInput.countedQuantity) : null;

        const updateData: any = {
          notes: itemInput.notes !== undefined ? itemInput.notes : item.notes,
          status: itemInput.status || "COUNTED"
        };

        if (isRecountItem) {
          updateData.recountQuantity = countedQty;
          updateData.recountedById = auth.userId;
          updateData.recountedAt = new Date();
        } else {
          updateData.countedQuantity = countedQty;
          if (item.firstCountedQuantity === null) {
            updateData.firstCountedQuantity = countedQty;
          }
          updateData.countedById = auth.userId;
          updateData.countedAt = new Date();
        }

        await tx.stockCountItem.update({
          where: { id: item.id },
          data: updateData
        });
      }

      const updated = await tx.stockCount.findUnique({
        where: { id },
        include: { items: true }
      });

      return updated;
    });
  },

  async start(auth: AuthContext, id: string, request: Request) {
    const count = await prisma.stockCount.findFirst({ where: { id, ...getCountWhere(auth) } });
    if (!count) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock count not found", StatusCodes.NOT_FOUND);
    if (count.status !== StockCountStatus.DRAFT && count.status !== StockCountStatus.SCHEDULED) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only draft or scheduled counts can be started", StatusCodes.CONFLICT);
    }
    const updated = await prisma.stockCount.update({
      where: { id },
      data: { status: StockCountStatus.IN_PROGRESS, startedAt: new Date(), frozenAt: new Date() }
    });
    await auditService.create({
      organizationId: auth.organizationId,
      branchId: count.branchId,
      userId: auth.userId,
      action: "stock_count.start",
      entityType: "StockCount",
      entityId: id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: count,
      afterData: updated
    });
    return updated;
  },

  async submit(auth: AuthContext, id: string, request: Request) {
    const count = await prisma.stockCount.findFirst({
      where: { id, ...getCountWhere(auth) },
      include: { items: true }
    });

    if (!count) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock count not found", StatusCodes.NOT_FOUND);

    if (count.status !== StockCountStatus.DRAFT && count.status !== StockCountStatus.IN_PROGRESS && count.status !== StockCountStatus.RECOUNT_REQUESTED) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Count cannot be submitted from its current status", StatusCodes.CONFLICT);
    }

    // Verify all items are counted
    const uncounted = count.items.filter((item) => item.status === "UNCOUNTED" || item.status === "RECOUNT_REQUIRED");
    if (uncounted.length > 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, `Cannot submit. There are ${uncounted.length} uncounted lines remaining.`, StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.stockCount.update({
      where: { id },
      data: { status: StockCountStatus.SUBMITTED, completedAt: new Date() }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: count.branchId,
      userId: auth.userId,
      action: "stock_count.submit",
      entityType: "StockCount",
      entityId: id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: count,
      afterData: updated
    });
    return updated;
  },

  async requestRecount(auth: AuthContext, id: string, itemIds: string[], request: Request) {
    const isManager = auth.role === "GENERAL_MANAGER" || auth.role === "BRANCH_MANAGER";
    if (!isManager) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only managers can request recounts", StatusCodes.FORBIDDEN);
    }

    const count = await prisma.stockCount.findFirst({
      where: { id, ...getCountWhere(auth) }
    });

    if (!count) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock count not found", StatusCodes.NOT_FOUND);
    if (count.status !== StockCountStatus.SUBMITTED) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Recounts can only be requested on submitted worksheets", StatusCodes.CONFLICT);
    }

    return prisma.$transaction(async (tx) => {
      await tx.stockCountItem.updateMany({
        where: {
          stockCountId: id,
          id: { in: itemIds }
        },
        data: {
          status: "RECOUNT_REQUIRED",
          recountQuantity: null
        }
      });

      const updated = await tx.stockCount.update({
        where: { id },
        data: {
          status: StockCountStatus.RECOUNT_REQUESTED
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: count.branchId,
        userId: auth.userId,
        action: "stock_count.request_recount",
        entityType: "StockCount",
        entityId: id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async approve(auth: AuthContext, id: string, request: Request) {
    const count = await prisma.stockCount.findFirst({
      where: { id, ...getCountWhere(auth) },
      include: {
        items: {
          include: {
            productVariant: true
          }
        }
      }
    });

    if (!count) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock count not found", StatusCodes.NOT_FOUND);
    if (count.status !== StockCountStatus.SUBMITTED) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only submitted counts can be approved", StatusCodes.CONFLICT);
    }

    if (count.createdById === auth.userId) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "The count creator cannot approve the same count", StatusCodes.FORBIDDEN);
    }

    return prisma.$transaction(async (tx) => {
      // Finalize item calculations
      for (const item of count.items) {
        const finalQty = item.recountQuantity !== null ? Number(item.recountQuantity) : (item.countedQuantity !== null ? Number(item.countedQuantity) : 0);
        const expectedQty = Number(item.expectedQuantity);
        const varianceQty = finalQty - expectedQty;
        const retailPrice = Number(item.productVariant.retailPrice || 0);
        const varianceVal = varianceQty * retailPrice;

        await tx.stockCountItem.update({
          where: { id: item.id },
          data: {
            finalQuantity: finalQty,
            varianceQuantity: varianceQty,
            varianceValue: varianceVal
          }
        });
      }

      const updated = await tx.stockCount.update({
        where: { id },
        data: { status: StockCountStatus.APPROVED, approvedById: auth.userId }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: count.branchId,
        userId: auth.userId,
        action: "stock_count.approve",
        entityType: "StockCount",
        entityId: id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: count,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async post(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const stockCount = await tx.stockCount.findFirst({
        where: { id, ...getCountWhere(auth) },
        include: {
          items: {
            include: {
              productVariant: true
            }
          }
        }
      });

      if (!stockCount) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock count not found", StatusCodes.NOT_FOUND);
      }

      if (stockCount.status !== StockCountStatus.APPROVED) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only approved stock counts can be posted", StatusCodes.CONFLICT);
      }

      if (stockCount.createdById === auth.userId) {
        throw new AppError(ERROR_CODES.ACCESS_DENIED, "The count creator cannot post the same count", StatusCodes.FORBIDDEN);
      }

      // Process variances and post inventory movements
      for (const item of stockCount.items) {
        const finalQty = item.finalQuantity !== null ? Number(item.finalQuantity) : (item.recountQuantity !== null ? Number(item.recountQuantity) : (item.countedQuantity !== null ? Number(item.countedQuantity) : 0));
        const expectedQty = Number(item.expectedQuantity);
        const variance = finalQty - expectedQty;

        // Force write back complete calculations just in case
        await tx.stockCountItem.update({
          where: { id: item.id },
          data: {
            finalQuantity: finalQty,
            varianceQuantity: variance,
            varianceValue: variance * Number(item.productVariant.retailPrice || 0)
          }
        });

        if (variance === 0) continue;

        // Perform stock adjustment using write service
        await inventoryWriteService.adjustStock(tx, {
          organizationId: stockCount.organizationId,
          branchId: stockCount.branchId,
          productVariantId: item.productVariantId,
          quantity: variance,
          movementType: InventoryMovementType.COUNT_VARIANCE,
          referenceType: "StockCountItem",
          referenceId: item.id,
          performedById: auth.userId,
          notes: `Stock count variance adjustment for CNT: ${stockCount.countNumber}`
        });
      }

      const posted = await tx.stockCount.update({
        where: { id: stockCount.id },
        data: {
          status: StockCountStatus.POSTED,
          completedAt: new Date(),
          postedById: auth.userId
        }
      });

      await auditService.create({
        organizationId: stockCount.organizationId,
        branchId: stockCount.branchId,
        userId: auth.userId,
        action: "stock_count.post",
        entityType: "StockCount",
        entityId: stockCount.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: stockCount,
        afterData: posted
      }, tx);

      return posted;
    });
  }
};
