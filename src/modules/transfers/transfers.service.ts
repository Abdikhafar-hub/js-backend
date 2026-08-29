import { Prisma, StockTransferStatus, InventoryMovementType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { inventoryWriteService } from "../../services/inventory-write.service.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";

const getTransferWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    OR: [
      scope.branchIds ? { sourceBranchId: { in: scope.branchIds } } : {},
      scope.branchIds ? { destinationBranchId: { in: scope.branchIds } } : {}
    ]
  };
};

export const transfersService = {
  async listOptions(auth: AuthContext, query: Record<string, any> = {}) {
    const sourceBranchId = typeof query.sourceBranchId === "string" ? query.sourceBranchId : "";

    if (sourceBranchId) {
      assertBranchAccess(auth, sourceBranchId);
    }

    const destinationBranches = await prisma.branch.findMany({
      where: {
        organizationId: auth.organizationId,
        status: "ACTIVE",
        ...(sourceBranchId ? { id: { not: sourceBranchId } } : {})
      },
      orderBy: {
        name: "asc"
      }
    });

    return {
      destinationBranches
    };
  },

  async list(auth: AuthContext, query: Record<string, any> = {}) {
    const where: any = getTransferWhere(auth);
    if (query.branchId) {
      assertBranchAccess(auth, String(query.branchId));
      where.AND = [{ OR: [{ sourceBranchId: String(query.branchId) }, { destinationBranchId: String(query.branchId) }] }];
    }
    return prisma.stockTransfer.findMany({
      where,
      include: {
        sourceBranch: true,
        destinationBranch: true,
        requestedBy: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async get(auth: AuthContext, id: string) {
    const transfer = await prisma.stockTransfer.findFirst({
      where: { id, ...getTransferWhere(auth) },
      include: {
        sourceBranch: true,
        destinationBranch: true,
        requestedBy: true,
        approvedBy: true,
        pickedBy: true,
        dispatchedBy: true,
        receivedBy: true,
        items: {
          include: {
            productVariant: {
              include: { product: true }
            },
            batches: {
              include: {
                inventoryBatch: true
              }
            }
          }
        }
      }
    });

    if (!transfer) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock transfer not found", StatusCodes.NOT_FOUND);
    }

    return transfer;
  },

  async create(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.sourceBranchId);
    if (input.sourceBranchId === input.destinationBranchId) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Source and destination branch must be different", StatusCodes.BAD_REQUEST);
    }

    return prisma.$transaction(async (tx) => {
      const destination = await tx.branch.findFirst({
        where: { id: input.destinationBranchId, organizationId: auth.organizationId, status: "ACTIVE" }
      });
      if (!destination) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Destination branch not found", StatusCodes.NOT_FOUND);
      }
      const count = await tx.stockTransfer.count({
        where: { organizationId: auth.organizationId }
      });
      const transferNumber = `TRF-${(count + 1).toString().padStart(6, "0")}`;

      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId: auth.organizationId,
          transferNumber,
          sourceBranchId: input.sourceBranchId,
          destinationBranchId: input.destinationBranchId,
          requestedById: auth.userId,
          status: StockTransferStatus.DRAFT,
          requestReason: input.requestReason || null
        }
      });

      for (const item of input.items) {
        await tx.stockTransferItem.create({
          data: {
            transferId: transfer.id,
            productVariantId: item.productVariantId,
            requestedQuantity: item.requestedQuantity,
            approvedQuantity: 0,
            dispatchedQuantity: 0,
            receivedQuantity: 0,
            notes: item.notes || null
          }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: input.sourceBranchId,
        userId: auth.userId,
        action: "transfer.create",
        entityType: "StockTransfer",
        entityId: transfer.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: transfer
      }, tx);

      return transfer;
    });
  },

  async submit(auth: AuthContext, id: string, request: Request) {
    const transfer = await this.get(auth, id);
    assertBranchAccess(auth, transfer.sourceBranchId);
    if (transfer.status !== StockTransferStatus.DRAFT) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Only draft transfers can be submitted", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: StockTransferStatus.REQUESTED,
        requestedAt: new Date()
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: transfer.sourceBranchId,
      userId: auth.userId,
      action: "transfer.submit",
      entityType: "StockTransfer",
      entityId: transfer.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: transfer,
      afterData: updated
    });

    return updated;
  },

  async approve(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, organizationId: auth.organizationId },
        include: { items: true }
      });

      if (!transfer || transfer.status !== StockTransferStatus.REQUESTED) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Transfer not found or not in requested state", StatusCodes.BAD_REQUEST);
      }

      for (const appItem of input.items) {
        const dbItem = transfer.items.find(item => item.id === appItem.itemId);
        if (!dbItem) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Transfer item not found", StatusCodes.BAD_REQUEST);
        }
        if (Number(appItem.approvedQuantity) > Number(dbItem.requestedQuantity)) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Approved quantity cannot exceed requested quantity", StatusCodes.BAD_REQUEST);
        }

        await tx.stockTransferItem.update({
          where: { id: dbItem.id },
          data: {
            approvedQuantity: appItem.approvedQuantity
          }
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: StockTransferStatus.APPROVED,
          approvedById: auth.userId,
          approvedAt: new Date()
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: transfer.sourceBranchId,
        userId: auth.userId,
        action: "transfer.approve",
        entityType: "StockTransfer",
        entityId: transfer.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: transfer,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async startPicking(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, organizationId: auth.organizationId },
        include: { items: true }
      });

      if (!transfer || transfer.status !== StockTransferStatus.APPROVED) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Transfer must be approved to start picking", StatusCodes.BAD_REQUEST);
      }
      assertBranchAccess(auth, transfer.sourceBranchId);

      // Reserve stock for each item at the source branch
      for (const item of transfer.items) {
        const approvedQty = Number(item.approvedQuantity);
        if (approvedQty <= 0) continue;

        await inventoryWriteService.reserveStock(tx, {
          organizationId: transfer.organizationId,
          branchId: transfer.sourceBranchId,
          productVariantId: item.productVariantId,
          quantity: approvedQty,
          sourceType: "StockTransferItem",
          sourceId: item.id,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48-hour reservation limit
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: StockTransferStatus.READY_FOR_DISPATCH,
          pickedById: auth.userId,
          pickedAt: new Date()
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: transfer.sourceBranchId,
        userId: auth.userId,
        action: "transfer.start_picking",
        entityType: "StockTransfer",
        entityId: transfer.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: transfer,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async dispatch(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, organizationId: auth.organizationId },
        include: { items: true }
      });

      if (!transfer || transfer.status !== StockTransferStatus.READY_FOR_DISPATCH) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Transfer must be picked to dispatch", StatusCodes.BAD_REQUEST);
      }
      assertBranchAccess(auth, transfer.sourceBranchId);

      for (const item of transfer.items) {
        const approvedQty = Number(item.approvedQuantity);
        if (approvedQty <= 0) continue;

        // Find reservation
        const reservation = await tx.inventoryReservation.findFirst({
          where: {
            sourceType: "StockTransferItem",
            sourceId: item.id,
            status: "ACTIVE"
          }
        });

        if (!reservation) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, `No active reservation found for transfer item ${item.id}`, StatusCodes.BAD_REQUEST);
        }

        // Fulfill reservation (deducts stock and returns batch allocations)
        const allocations = await inventoryWriteService.fulfillReservation(tx, reservation.id, auth.userId);

        if (allocations && allocations.length > 0) {
          for (const alloc of allocations) {
            await tx.stockTransferItemBatch.create({
              data: {
                transferItemId: item.id,
                inventoryBatchId: alloc.batchId,
                dispatchedQuantity: alloc.quantityAllocated,
                receivedQuantity: 0
              }
            });
          }
        }

        // Update item dispatched qty
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: {
            dispatchedQuantity: approvedQty
          }
        });

        // Increment in-transit quantity at destination branch
        const destBalance = await inventoryWriteService.lockBalance(tx, transfer.organizationId, transfer.destinationBranchId, item.productVariantId);
        await tx.inventoryBalance.update({
          where: { id: destBalance.id },
          data: {
            quantityInTransit: { increment: approvedQty }
          }
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: StockTransferStatus.DISPATCHED,
          dispatchedById: auth.userId,
          dispatchedAt: new Date()
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: transfer.sourceBranchId,
        userId: auth.userId,
        action: "transfer.dispatch",
        entityType: "StockTransfer",
        entityId: transfer.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: transfer,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async receive(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, organizationId: auth.organizationId },
        include: {
          items: {
            include: {
              batches: {
                include: {
                  inventoryBatch: true
                }
              }
            }
          }
        }
      });

      if (!transfer || transfer.status !== StockTransferStatus.DISPATCHED) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Transfer must be dispatched to receive", StatusCodes.BAD_REQUEST);
      }
      assertBranchAccess(auth, transfer.destinationBranchId);

      let hasDiscrepancy = false;

      for (const recItem of input.items) {
        const dbItem = transfer.items.find(item => item.id === recItem.itemId);
        if (!dbItem) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Transfer item not found", StatusCodes.BAD_REQUEST);
        }

        const dispatchedQty = Number(dbItem.dispatchedQuantity);
        const receivedQty = Number(recItem.receivedQuantity);
        const damagedQty = Number(recItem.damagedQuantity);
        const missingQty = Number(recItem.missingQuantity);

        if (receivedQty + damagedQty + missingQty !== dispatchedQty || damagedQty > 0 || missingQty > 0) {
          hasDiscrepancy = true;
        }

        // Decrement in-transit on destination balance
        const destBalance = await inventoryWriteService.lockBalance(tx, transfer.organizationId, transfer.destinationBranchId, dbItem.productVariantId);
        await tx.inventoryBalance.update({
          where: { id: destBalance.id },
          data: {
            quantityInTransit: { decrement: dispatchedQty }
          }
        });

        // Add received stock to destination branch using in-transit batches original cost values
        if (receivedQty > 0) {
          for (const itemBatch of dbItem.batches) {
            const batchShare = (Number(itemBatch.dispatchedQuantity) / dispatchedQty) * receivedQty;
            if (batchShare <= 0) continue;

            await inventoryWriteService.receiveStock(tx, {
              organizationId: transfer.organizationId,
              branchId: transfer.destinationBranchId,
              productVariantId: dbItem.productVariantId,
              quantity: batchShare,
              unitCost: Number(itemBatch.inventoryBatch.unitCost),
              landedUnitCost: Number(itemBatch.inventoryBatch.landedUnitCost),
              batchNumber: itemBatch.inventoryBatch.batchNumber || undefined,
              manufactureDate: itemBatch.inventoryBatch.manufactureDate || undefined,
              expiryDate: itemBatch.inventoryBatch.expiryDate || undefined,
              referenceType: "StockTransferItemBatch",
              referenceId: itemBatch.id,
              performedById: auth.userId
            });

            // Update receiving on transfer batch logs
            await tx.stockTransferItemBatch.update({
              where: { id: itemBatch.id },
              data: {
                receivedQuantity: batchShare,
                damagedQuantity: (Number(itemBatch.dispatchedQuantity) / dispatchedQty) * damagedQty,
                missingQuantity: (Number(itemBatch.dispatchedQuantity) / dispatchedQty) * missingQty
              }
            });
          }
        }

        // Update transfer item record
        await tx.stockTransferItem.update({
          where: { id: dbItem.id },
          data: {
            receivedQuantity: receivedQty,
            damagedInTransitQuantity: damagedQty,
            missingQuantity: missingQty
          }
        });
      }

      const finalStatus = hasDiscrepancy ? StockTransferStatus.DISCREPANCY_REVIEW : StockTransferStatus.RECEIVED;

      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: finalStatus,
          receivedById: auth.userId,
          receivedAt: new Date()
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: transfer.destinationBranchId,
        userId: auth.userId,
        action: "transfer.receive",
        entityType: "StockTransfer",
        entityId: transfer.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: transfer,
        afterData: updated
      }, tx);

      return updated;
    });
  }
};
