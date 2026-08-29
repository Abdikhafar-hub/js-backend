import { Prisma, LoyaltyLedgerEntryType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import type { AuthContext } from "../../types/auth.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";

export const loyaltyService = {
  async getLoyaltyHistory(auth: AuthContext, customerId: string) {
    const scope = buildUserScope(auth);
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId: auth.organizationId,
        ...(scope.branchIds ? {
          OR: [
            { preferredBranchId: { in: scope.branchIds } },
            { sales: { some: { branchId: { in: scope.branchIds } } } }
          ]
        } : {})
      }
    });

    if (!customer) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer not found", StatusCodes.NOT_FOUND);
    }

    const ledger = await prisma.loyaltyLedgerEntry.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" }
    });

    return {
      pointsBalance: customer.loyaltyPointsBalance,
      history: ledger
    };
  },

  async redeemPoints(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      assertBranchAccess(auth, input.branchId);
      const customer = await tx.customer.findFirst({
        where: {
          id: input.customerId,
          organizationId: auth.organizationId,
          OR: [
            { preferredBranchId: input.branchId },
            { sales: { some: { branchId: input.branchId } } }
          ]
        }
      });

      if (!customer) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer not found", StatusCodes.NOT_FOUND);
      }

      const pointsToRedeem = input.points;
      const currentPoints = Number(customer.loyaltyPointsBalance);
      const settings = await tx.organizationSetting.findUnique({ where: { organizationId: auth.organizationId } });
      if (!settings?.loyaltyEnabled) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Loyalty redemption is disabled", StatusCodes.CONFLICT);
      }
      const existing = await tx.loyaltyLedgerEntry.findFirst({
        where: { customerId: customer.id, referenceType: "Redemption", referenceId: input.idempotencyKey }
      });
      if (existing) return { customer, loyaltyLedger: existing };

      if (currentPoints < pointsToRedeem) {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          `Insufficient loyalty points. Balance: ${currentPoints}, Requested: ${pointsToRedeem}`,
          StatusCodes.BAD_REQUEST
        );
      }

      const pointsAfter = currentPoints - pointsToRedeem;
      const redemptionValue = pointsToRedeem; // 1 point = 1 KES store credit

      // Create loyalty ledger log
      const loyaltyLedger = await tx.loyaltyLedgerEntry.create({
        data: {
          customerId: customer.id,
          entryType: LoyaltyLedgerEntryType.REDEEMED,
          points: -pointsToRedeem,
          referenceType: "Redemption",
          referenceId: input.idempotencyKey,
          notes: input.notes || `Redeemed ${pointsToRedeem} points for KES ${redemptionValue} store credit`
        }
      });

      const balanceBefore = Number(customer.storeCreditBalance);
      const balanceAfter = balanceBefore + redemptionValue;

      // Update customer finance outstanding and loyalty balances
      const updatedCustomer = await tx.customer.update({
        where: { id: customer.id },
        data: {
          storeCreditBalance: balanceAfter,
          loyaltyPointsBalance: pointsAfter
        }
      });
      await tx.customerLedgerEntry.create({
        data: {
          organizationId: auth.organizationId, branchId: input.branchId, customerId: customer.id,
          entryType: "LOYALTY_REDEMPTION", balanceType: "STORE_CREDIT", amount: redemptionValue,
          balanceBefore, balanceAfter, referenceType: "LoyaltyLedgerEntry", referenceId: loyaltyLedger.id,
          notes: loyaltyLedger.notes, createdById: auth.userId
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "loyalty.redeem",
        entityType: "LoyaltyLedgerEntry",
        entityId: loyaltyLedger.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: { loyaltyLedger, updatedCustomer }
      }, tx);

      return {
        customer: updatedCustomer,
        loyaltyLedger
      };
    });
  },

  async listPrograms(auth: AuthContext) {
    const setting = await prisma.organizationSetting.findUnique({
      where: { organizationId: auth.organizationId }
    });

    return [
      {
        id: "standard",
        name: "Standard Rewards Program",
        description: "Earn 1 point for every 100 KES spent, redeem 1 KES store credit per point.",
        loyaltyEnabled: setting?.loyaltyEnabled ?? false,
        earningRatio: 100,
        redemptionRatio: 1,
        createdAt: setting?.createdAt ?? new Date()
      }
    ];
  },

  async saveProgram(auth: AuthContext, input: Record<string, any>) {
    const setting = await prisma.organizationSetting.upsert({
      where: { organizationId: auth.organizationId },
      update: { loyaltyEnabled: input.loyaltyEnabled },
      create: { organizationId: auth.organizationId, loyaltyEnabled: input.loyaltyEnabled }
    });

    return {
      id: "standard",
      name: "Standard Rewards Program",
      description: "Earn 1 point for every 100 KES spent, redeem 1 KES store credit per point.",
      loyaltyEnabled: setting.loyaltyEnabled,
      earningRatio: 100,
      redemptionRatio: 1,
      createdAt: setting.createdAt
    };
  },

  async adjustPoints(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: auth.organizationId }
      });

      if (!customer) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer not found", StatusCodes.NOT_FOUND);
      }

      const pointsBefore = Number(customer.loyaltyPointsBalance);
      const pointsAfter = Math.max(0, pointsBefore + input.points);

      const entry = await tx.loyaltyLedgerEntry.create({
        data: {
          customerId: customer.id,
          entryType: "ADJUSTED",
          points: input.points,
          referenceType: "ManualAdjustment",
          referenceId: auth.userId,
          notes: input.reason
        }
      });

      const updatedCustomer = await tx.customer.update({
        where: { id: customer.id },
        data: { loyaltyPointsBalance: pointsAfter }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "loyalty.adjust",
        entityType: "Customer",
        entityId: customer.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: { entry, updatedCustomer }
      }, tx);

      return { customer: updatedCustomer, entry };
    });
  }
};
