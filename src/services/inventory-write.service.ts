import { Prisma, InventoryMovementType, InventoryBatchStatus, InventoryReservationStatus } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { StatusCodes } from "http-status-codes";

export const inventoryWriteService = {
  /**
   * Locks the inventory balance row for a specific branch and variant.
   * If it doesn't exist, it creates one with 0 quantities and then locks it.
   */
  async lockBalance(
    tx: Prisma.TransactionClient,
    organizationId: string,
    branchId: string,
    productVariantId: string
  ) {
    let balance = await tx.inventoryBalance.findUnique({
      where: {
        organizationId_branchId_productVariantId: {
          organizationId,
          branchId,
          productVariantId
        }
      }
    });

    if (!balance) {
      balance = await tx.inventoryBalance.create({
        data: {
          organizationId,
          branchId,
          productVariantId,
          quantityOnHand: 0,
          quantityReserved: 0,
          quantityAvailable: 0,
          quantityInTransit: 0,
          averageUnitCost: 0
        }
      });
    }

    // Row-level lock for concurrency protection
    await tx.$queryRaw`
      SELECT id FROM "InventoryBalance"
      WHERE "organizationId" = ${organizationId}
        AND "branchId" = ${branchId}
        AND "productVariantId" = ${productVariantId}
      FOR UPDATE
    `;

    return balance;
  },

  /**
   * Receives stock into the inventory, updating average unit cost, batches, and creating a movement record.
   */
  async receiveStock(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      branchId: string;
      productVariantId: string;
      quantity: number;
      unitCost: number;
      landedUnitCost: number;
      movementType?: InventoryMovementType;
      batchNumber?: string;
      manufactureDate?: Date;
      expiryDate?: Date;
      referenceType: string;
      referenceId: string;
      performedById?: string;
      notes?: string;
      inventoryBatchId?: string;
    }
  ) {
    const {
      organizationId,
      branchId,
      productVariantId,
      quantity,
      unitCost,
      landedUnitCost,
      movementType,
      batchNumber,
      manufactureDate,
      expiryDate,
      referenceType,
      referenceId,
      performedById,
      notes,
      inventoryBatchId
    } = data;

    if (quantity <= 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Quantity must be greater than zero", StatusCodes.BAD_REQUEST);
    }

    const currentBalance = await this.lockBalance(tx, organizationId, branchId, productVariantId);

    // Calculate new average unit cost
    const currentQty = Number(currentBalance.quantityOnHand);
    const currentAvg = Number(currentBalance.averageUnitCost);
    const newQty = currentQty + quantity;
    let newAvgCost = currentAvg;

    if (newQty > 0) {
      newAvgCost = ((currentQty * currentAvg) + (quantity * landedUnitCost)) / newQty;
    } else {
      newAvgCost = landedUnitCost;
    }

    // Update Inventory Balance
    const updatedBalance = await tx.inventoryBalance.update({
      where: { id: currentBalance.id },
      data: {
        quantityOnHand: { increment: quantity },
        quantityAvailable: { increment: quantity },
        averageUnitCost: newAvgCost,
        lastMovementAt: new Date(),
        version: { increment: 1 }
      }
    });

    // Handle batch tracking
    let batchId: string | undefined;
    if (inventoryBatchId) {
      const batch = await tx.inventoryBatch.update({
        where: { id: inventoryBatchId },
        data: {
          quantityOnHand: { increment: quantity }
        }
      });
      batchId = batch.id;
    } else if (batchNumber) {
      let batch = await tx.inventoryBatch.findFirst({
        where: {
          organizationId,
          branchId,
          productVariantId,
          batchNumber
        }
      });

      if (!batch) {
        batch = await tx.inventoryBatch.create({
          data: {
            organizationId,
            branchId,
            productVariantId,
            batchNumber,
            manufactureDate,
            expiryDate,
            quantityOnHand: quantity,
            quantityReserved: 0,
            unitCost,
            landedUnitCost,
            status: expiryDate && new Date(expiryDate) < new Date() ? InventoryBatchStatus.EXPIRED : InventoryBatchStatus.ACTIVE
          }
        });
      } else {
        batch = await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: {
            quantityOnHand: { increment: quantity }
          }
        });
      }
      batchId = batch.id;
    }

    // Create movement log
    const movementNumber = `MVT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    await tx.inventoryMovement.create({
      data: {
        organizationId,
        branchId,
        productVariantId,
        inventoryBatchId: batchId,
        movementNumber,
        movementType: movementType || InventoryMovementType.PURCHASE_RECEIPT,
        referenceType,
        referenceId,
        quantity,
        unitCost,
        totalCost: quantity * landedUnitCost,
        quantityBefore: currentQty,
        quantityAfter: newQty,
        performedById,
        reason: notes
      }
    });

    return updatedBalance;
  },

  /**
   * Reserves stock for orders or transfers.
   */
  async reserveStock(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      branchId: string;
      productVariantId: string;
      quantity: number;
      sourceType: string;
      sourceId: string;
      expiresAt: Date;
    }
  ) {
    const { organizationId, branchId, productVariantId, quantity, sourceType, sourceId, expiresAt } = data;

    const currentBalance = await this.lockBalance(tx, organizationId, branchId, productVariantId);

    const available = Number(currentBalance.quantityAvailable);
    if (available < quantity) {
      // Check branch settings
      const branch = await tx.branch.findUnique({ where: { id: branchId } });
      if (!branch?.allowsNegativeStock) {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          `Insufficient stock available for variant ${productVariantId}. Available: ${available}, Requested: ${quantity}`,
          StatusCodes.BAD_REQUEST
        );
      }
    }

    // Create reservation
    const reservation = await tx.inventoryReservation.create({
      data: {
        organizationId,
        branchId,
        productVariantId,
        quantity,
        sourceType,
        sourceId,
        expiresAt,
        status: InventoryReservationStatus.ACTIVE
      }
    });

    // Update balance
    await tx.inventoryBalance.update({
      where: { id: currentBalance.id },
      data: {
        quantityReserved: { increment: quantity },
        quantityAvailable: { decrement: quantity }
      }
    });

    return reservation;
  },

  /**
   * Releases an active reservation, restoring available quantity.
   */
  async releaseReservation(tx: Prisma.TransactionClient, reservationId: string) {
    const reservation = await tx.inventoryReservation.findUnique({
      where: { id: reservationId }
    });

    if (!reservation || reservation.status !== InventoryReservationStatus.ACTIVE) {
      return;
    }

    const currentBalance = await this.lockBalance(tx, reservation.organizationId, reservation.branchId, reservation.productVariantId);

    // Update reservation status
    await tx.inventoryReservation.update({
      where: { id: reservationId },
      data: {
        status: InventoryReservationStatus.RELEASED,
        releasedAt: new Date()
      }
    });

    // Restore balance
    await tx.inventoryBalance.update({
      where: { id: currentBalance.id },
      data: {
        quantityReserved: { decrement: reservation.quantity },
        quantityAvailable: { increment: reservation.quantity }
      }
    });
  },

  /**
   * Fulfills a reservation, decreasing on-hand quantity and reserved quantity.
   * Runs FIFO deduction on batches.
   */
  async fulfillReservation(
    tx: Prisma.TransactionClient,
    reservationId: string,
    performedById?: string
  ) {
    const reservation = await tx.inventoryReservation.findUnique({
      where: { id: reservationId }
    });

    if (!reservation || reservation.status !== InventoryReservationStatus.ACTIVE) {
      return;
    }

    const currentBalance = await this.lockBalance(tx, reservation.organizationId, reservation.branchId, reservation.productVariantId);
    const qty = Number(reservation.quantity);

    // Update reservation
    await tx.inventoryReservation.update({
      where: { id: reservationId },
      data: {
        status: InventoryReservationStatus.FULFILLED,
        fulfilledAt: new Date()
      }
    });

    // Decrement from on-hand and reserved
    await tx.inventoryBalance.update({
      where: { id: currentBalance.id },
      data: {
        quantityOnHand: { decrement: qty },
        quantityReserved: { decrement: qty }
      }
    });

    // Deduct from batches using FIFO
    const allocations = await this.deductFromBatchesFIFO(tx, {
      organizationId: reservation.organizationId,
      branchId: reservation.branchId,
      productVariantId: reservation.productVariantId,
      quantity: qty
    });

    // Create movement log
    const movementNumber = `MVT-FUL-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    await tx.inventoryMovement.create({
      data: {
        organizationId: reservation.organizationId,
        branchId: reservation.branchId,
        productVariantId: reservation.productVariantId,
        movementNumber,
        movementType: InventoryMovementType.SALE,
        referenceType: reservation.sourceType,
        referenceId: reservation.sourceId,
        quantity: -qty,
        unitCost: currentBalance.averageUnitCost,
        totalCost: -qty * Number(currentBalance.averageUnitCost),
        quantityBefore: currentBalance.quantityOnHand,
        quantityAfter: Number(currentBalance.quantityOnHand) - qty,
        performedById,
        reason: "Fulfillment of reservation"
      }
    });

    return allocations;
  },

  /**
   * Deducts quantity directly from inventory (e.g. POS cash sales) without prior reservation.
   * Applies FIFO to batch tracking.
   */
  async deductStock(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      branchId: string;
      productVariantId: string;
      quantity: number;
      referenceType: string;
      referenceId: string;
      movementType: InventoryMovementType;
      performedById?: string;
      notes?: string;
      inventoryBatchId?: string;
    }
  ) {
    const {
      organizationId,
      branchId,
      productVariantId,
      quantity,
      referenceType,
      referenceId,
      movementType,
      performedById,
      notes,
      inventoryBatchId
    } = data;

    if (quantity <= 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Quantity must be greater than zero", StatusCodes.BAD_REQUEST);
    }

    const currentBalance = await this.lockBalance(tx, organizationId, branchId, productVariantId);
    const available = Number(currentBalance.quantityAvailable);

    if (available < quantity) {
      const branch = await tx.branch.findUnique({ where: { id: branchId } });
      if (!branch?.allowsNegativeStock) {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          `Insufficient stock available. Available: ${available}, Requested: ${quantity}`,
          StatusCodes.BAD_REQUEST
        );
      }
    }

    // Update balance
    const updatedBalance = await tx.inventoryBalance.update({
      where: { id: currentBalance.id },
      data: {
        quantityOnHand: { decrement: quantity },
        quantityAvailable: { decrement: quantity },
        lastMovementAt: new Date(),
        version: { increment: 1 }
      }
    });

    // Apply specific batch or FIFO to batches
    let allocations: Array<{
      batchId: string;
      batchNumber: string | null;
      quantityAllocated: number;
      unitCost: number;
      landedUnitCost: number;
    }> = [];

    if (inventoryBatchId) {
      const batch = await tx.inventoryBatch.update({
        where: { id: inventoryBatchId },
        data: {
          quantityOnHand: { decrement: quantity }
        }
      });
      allocations = [{
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantityAllocated: quantity,
        unitCost: Number(batch.unitCost),
        landedUnitCost: Number(batch.landedUnitCost)
      }];
    } else {
      allocations = await this.deductFromBatchesFIFO(tx, {
        organizationId,
        branchId,
        productVariantId,
        quantity
      });
    }

    // Create movement
    const movementNumber = `MVT-DED-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    await tx.inventoryMovement.create({
      data: {
        organizationId,
        branchId,
        productVariantId,
        inventoryBatchId: allocations.length === 1 ? allocations[0]?.batchId : null,
        movementNumber,
        movementType,
        referenceType,
        referenceId,
        quantity: -quantity,
        unitCost: currentBalance.averageUnitCost,
        totalCost: -quantity * Number(currentBalance.averageUnitCost),
        quantityBefore: currentBalance.quantityOnHand,
        quantityAfter: Number(currentBalance.quantityOnHand) - quantity,
        performedById,
        reason: notes
      }
    });

    return {
      balance: updatedBalance,
      allocations
    };
  },

  /**
   * Adjusts stock based on stock count variances or write-offs.
   */
  async adjustStock(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      branchId: string;
      productVariantId: string;
      quantity: number; // positive or negative
      unitCost?: number;
      movementType?: InventoryMovementType;
      referenceType: string;
      referenceId: string;
      performedById?: string;
      notes?: string;
      inventoryBatchId?: string;
    }
  ) {
    const {
      organizationId,
      branchId,
      productVariantId,
      quantity,
      unitCost,
      movementType,
      referenceType,
      referenceId,
      performedById,
      notes,
      inventoryBatchId
    } = data;

    if (quantity === 0) return;

    if (quantity > 0) {
      return this.receiveStock(tx, {
        organizationId,
        branchId,
        productVariantId,
        quantity,
        unitCost: unitCost || 0,
        landedUnitCost: unitCost || 0,
        movementType: movementType || InventoryMovementType.STOCK_ADJUSTMENT_IN,
        referenceType,
        referenceId,
        performedById,
        notes,
        inventoryBatchId
      });
    } else {
      return this.deductStock(tx, {
        organizationId,
        branchId,
        productVariantId,
        quantity: Math.abs(quantity),
        referenceType,
        referenceId,
        movementType: movementType || InventoryMovementType.STOCK_ADJUSTMENT_OUT,
        performedById,
        notes,
        inventoryBatchId
      });
    }
  },

  /**
   * Internal helper to deduct quantities from batches in FIFO order.
   */
  async deductFromBatchesFIFO(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      branchId: string;
      productVariantId: string;
      quantity: number;
    }
  ) {
    const { organizationId, branchId, productVariantId, quantity } = data;
    let remaining = quantity;

    // Find active batches with positive quantity
    const batches = await tx.inventoryBatch.findMany({
      where: {
        organizationId,
        branchId,
        productVariantId,
        quantityOnHand: { gt: 0 }
      },
      orderBy: [
        { expiryDate: "asc" },
        { createdAt: "asc" }
      ]
    });

    const allocations: Array<{
      batchId: string;
      batchNumber: string | null;
      quantityAllocated: number;
      unitCost: number;
      landedUnitCost: number;
    }> = [];

    for (const batch of batches) {
      if (remaining <= 0) break;

      const batchQty = Number(batch.quantityOnHand);
      const toDeduct = Math.min(batchQty, remaining);

      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: {
          quantityOnHand: { decrement: toDeduct }
        }
      });

      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantityAllocated: toDeduct,
        unitCost: Number(batch.unitCost),
        landedUnitCost: Number(batch.landedUnitCost)
      });

      remaining -= toDeduct;
    }

    // If remaining quantity > 0 and no batches left, let the last batch or a fallback batch handle it
    if (remaining > 0) {
      // Find any batch or create a fallback batch
      let fallbackBatch = batches[batches.length - 1];

      if (!fallbackBatch) {
        fallbackBatch = await tx.inventoryBatch.create({
          data: {
            organizationId,
            branchId,
            productVariantId,
            batchNumber: "FALLBACK",
            quantityOnHand: -remaining,
            quantityReserved: 0,
            unitCost: 0,
            landedUnitCost: 0,
            status: InventoryBatchStatus.ACTIVE
          }
        });
      } else {
        await tx.inventoryBatch.update({
          where: { id: fallbackBatch.id },
          data: {
            quantityOnHand: { decrement: remaining }
          }
        });
      }

      allocations.push({
        batchId: fallbackBatch.id,
        batchNumber: fallbackBatch.batchNumber,
        quantityAllocated: remaining,
        unitCost: Number(fallbackBatch.unitCost),
        landedUnitCost: Number(fallbackBatch.landedUnitCost)
      });
    }

    return allocations;
  }
};
