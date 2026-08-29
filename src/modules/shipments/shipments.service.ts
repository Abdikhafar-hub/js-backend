import { Prisma, ImportShipmentStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { landedCostService } from "../../services/landed-cost.service.js";
import { buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";

const allowedShipmentTransitions: Record<ImportShipmentStatus, ImportShipmentStatus[]> = {
  PLANNED: [ImportShipmentStatus.BOOKED, ImportShipmentStatus.CANCELLED],
  BOOKED: [ImportShipmentStatus.IN_TRANSIT, ImportShipmentStatus.CANCELLED],
  IN_TRANSIT: [ImportShipmentStatus.ARRIVED, ImportShipmentStatus.CANCELLED],
  ARRIVED: [ImportShipmentStatus.UNDER_CUSTOMS_CLEARANCE, ImportShipmentStatus.CLEARED, ImportShipmentStatus.RECEIVED],
  UNDER_CUSTOMS_CLEARANCE: [ImportShipmentStatus.CLEARED, ImportShipmentStatus.CANCELLED],
  CLEARED: [ImportShipmentStatus.RECEIVED, ImportShipmentStatus.CANCELLED],
  RECEIVED: [],
  CANCELLED: []
};

const getShipmentWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId
  };
};

export const shipmentsService = {
  async list(auth: AuthContext) {
    return prisma.importShipment.findMany({
      where: getShipmentWhere(auth),
      include: {
        supplier: true,
        purchaseOrder: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async get(auth: AuthContext, id: string) {
    const shipment = await prisma.importShipment.findFirst({
      where: { id, organizationId: auth.organizationId },
      include: {
        supplier: true,
        purchaseOrder: {
          include: {
            items: {
              include: {
                productVariant: {
                  include: { product: true }
                }
              }
            }
          }
        },
        costs: true,
        allocations: {
          include: {
            productVariant: {
              include: { product: true }
            }
          }
        }
      }
    });

    if (!shipment) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Import shipment not found", StatusCodes.NOT_FOUND);
    }

    return shipment;
  },

  async create(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findFirst({
        where: {
          id: input.purchaseOrderId,
          organizationId: auth.organizationId
        }
      });

      if (!purchaseOrder) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Purchase order not found", StatusCodes.NOT_FOUND);
      }

      if (purchaseOrder.supplierId !== input.supplierId) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Supplier does not match the selected purchase order", StatusCodes.BAD_REQUEST);
      }

      const count = await tx.importShipment.count({
        where: { organizationId: auth.organizationId }
      });
      const shipmentNumber = `SHP-${(count + 1).toString().padStart(6, "0")}`;

      const shipment = await tx.importShipment.create({
        data: {
          organizationId: auth.organizationId,
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId,
          shipmentNumber,
          shippingMethod: input.shippingMethod || null,
          originCountry: input.originCountry || null,
          destinationCountry: input.destinationCountry || null,
          carrier: input.carrier || null,
          trackingNumber: input.trackingNumber || null,
          containerNumber: input.containerNumber || null,
          billOfLadingNumber: input.billOfLadingNumber || null,
          departureDate: input.departureDate ? new Date(input.departureDate) : null,
          expectedArrivalDate: input.expectedArrivalDate ? new Date(input.expectedArrivalDate) : null,
          actualArrivalDate: input.actualArrivalDate ? new Date(input.actualArrivalDate) : null,
          customsClearanceDate: input.customsClearanceDate ? new Date(input.customsClearanceDate) : null,
          status: ImportShipmentStatus.PLANNED,
          currencyCode: input.currencyCode || "KES",
          exchangeRate: input.exchangeRate || 1.0,
          notes: input.notes || null
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "shipment.create",
        entityType: "ImportShipment",
        entityId: shipment.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: shipment
      }, tx);

      return shipment;
    });
  },

  async addCost(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const shipment = await tx.importShipment.findFirst({
        where: { id, organizationId: auth.organizationId }
      });

      if (!shipment) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found", StatusCodes.NOT_FOUND);
      }

      const cost = await tx.importShipmentCost.create({
        data: {
          shipmentId: shipment.id,
          costType: input.costType,
          amount: input.amount,
          currencyCode: input.currencyCode,
          exchangeRate: input.exchangeRate || 1.0,
          baseCurrencyAmount: input.amount * (input.exchangeRate || 1.0),
          allocationMethod: input.allocationMethod,
          reference: input.reference || null,
          notes: input.notes || null
        }
      });

      // Update shipment totals based on cost type
      const amt = Number(cost.baseCurrencyAmount);
      const updateData: Record<string, any> = {};

      if (cost.costType.toUpperCase().includes("FREIGHT")) {
        updateData.freightCost = { increment: amt };
      } else if (cost.costType.toUpperCase().includes("INSURANCE")) {
        updateData.insuranceCost = { increment: amt };
      } else if (cost.costType.toUpperCase().includes("DUTY") || cost.costType.toUpperCase().includes("CUSTOMS")) {
        updateData.customsDuty = { increment: amt };
      } else if (cost.costType.toUpperCase().includes("CLEARING")) {
        updateData.clearingFees = { increment: amt };
      } else if (cost.costType.toUpperCase().includes("TRANSPORT") || cost.costType.toUpperCase().includes("HAULAGE")) {
        updateData.transportCost = { increment: amt };
      } else if (cost.costType.toUpperCase().includes("HANDLING")) {
        updateData.handlingCost = { increment: amt };
      } else {
        updateData.otherCosts = { increment: amt };
      }

      const updatedShipment = await tx.importShipment.update({
        where: { id: shipment.id },
        data: updateData
      });

      await auditService.create({
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "shipment.add_cost",
        entityType: "ImportShipmentCost",
        entityId: cost.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: cost
      }, tx);

      // Automatically recalculate allocations
      await this.recalculateAllocations(tx, shipment.id);

      return { cost, shipment: updatedShipment };
    });
  },

  async recalculateAllocations(tx: Prisma.TransactionClient, shipmentId: string) {
    const shipment = await tx.importShipment.findUnique({
      where: { id: shipmentId },
      include: {
        purchaseOrder: {
          include: {
            items: true
          }
        },
        costs: true
      }
    });

    if (!shipment) return;

    const items = shipment.purchaseOrder.items.map(item => ({
      productVariantId: item.productVariantId,
      quantity: Number(item.quantityOrdered),
      unitCost: Number(item.unitCost),
      weight: 0 // Weight is not explicitly stored in PurchaseOrderItem, we pass 0 (will fallback to quantity)
    }));

    const costs = shipment.costs.map(cost => ({
      amount: Number(cost.amount),
      exchangeRate: Number(cost.exchangeRate),
      allocationMethod: cost.allocationMethod
    }));

    // Calculate using engine
    const allocationResult = landedCostService.allocateCosts(items, costs);

    // Remove old allocations
    await tx.importShipmentItemAllocation.deleteMany({
      where: { shipmentId }
    });

    // Save new allocations
    for (const [variantId, baseAmount] of Object.entries(allocationResult)) {
      await tx.importShipmentItemAllocation.create({
        data: {
          shipmentId,
          productVariantId: variantId,
          allocatedAmount: baseAmount as number,
          baseCurrencyAmount: baseAmount as number
        }
      });
    }
  },

  async updateStatus(auth: AuthContext, id: string, status: ImportShipmentStatus, request: Request) {
    const shipment = await this.get(auth, id);

    if (!allowedShipmentTransitions[shipment.status]?.includes(status)) {
      throw new AppError(
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Cannot move shipment from ${shipment.status} to ${status}`,
        StatusCodes.BAD_REQUEST
      );
    }

    const updated = await prisma.importShipment.update({
      where: { id: shipment.id },
      data: { status }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "shipment.update_status",
      entityType: "ImportShipment",
      entityId: shipment.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: shipment,
      afterData: updated
    });

    return updated;
  }
};
