import {
  Prisma,
  StockAdjustmentType,
  StockIssueReportStatus,
  StockIssueType,
  UserRole
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { auditService } from "../../services/audit.service.js";
import type { AuthContext } from "../../types/auth.js";

const mapIssueTypeToAdjustmentType = (issueType: StockIssueType): StockAdjustmentType => {
  switch (issueType) {
    case StockIssueType.DAMAGE:
      return StockAdjustmentType.DAMAGE;
    case StockIssueType.LOSS:
      return StockAdjustmentType.LOSS;
    case StockIssueType.EXPIRY:
      return StockAdjustmentType.EXPIRY;
    case StockIssueType.FOUND_STOCK:
      return StockAdjustmentType.FOUND_STOCK;
    case StockIssueType.DATA_CORRECTION:
      return StockAdjustmentType.DATA_CORRECTION;
    case StockIssueType.INTERNAL_USE:
      return StockAdjustmentType.INTERNAL_USE;
    case StockIssueType.SAMPLE:
      return StockAdjustmentType.SAMPLE_USAGE;
    case StockIssueType.TESTER:
      return StockAdjustmentType.TESTER_USAGE;
    default:
      return StockAdjustmentType.OTHER;
  }
};

const getIssueWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
    ...(auth.role === UserRole.SALES_ATTENDANT ? { reportedById: auth.userId } : {})
  };
};

const ensureBatchAccess = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  input: { branchId: string; productVariantId: string; inventoryBatchId?: string }
) => {
  if (!input.inventoryBatchId) {
    return;
  }

  const batch = await tx.inventoryBatch.findFirst({
    where: {
      id: input.inventoryBatchId,
      organizationId: auth.organizationId,
      branchId: input.branchId,
      productVariantId: input.productVariantId
    }
  });

  if (!batch) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Inventory batch not found", StatusCodes.NOT_FOUND);
  }
};

export const stockIssuesService = {
  async list(auth: AuthContext, query: Record<string, any> = {}) {
    const where: any = getIssueWhere(auth);
    if (query.branchId) { assertBranchAccess(auth, String(query.branchId)); where.branchId = String(query.branchId); }
    return prisma.stockIssueReport.findMany({
      where,
      include: {
        branch: true,
        productVariant: {
          include: {
            product: true
          }
        },
        inventoryBatch: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async get(auth: AuthContext, id: string) {
    const issue = await prisma.stockIssueReport.findFirst({
      where: {
        id,
        ...getIssueWhere(auth)
      },
      include: {
        branch: true,
        productVariant: {
          include: {
            product: true
          }
        },
        inventoryBatch: true
      }
    });

    if (!issue) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock issue not found", StatusCodes.NOT_FOUND);
    }

    return issue;
  },

  async create(auth: AuthContext, input: Record<string, unknown>, request: Request) {
    const branchId = String(input.branchId);
    const productVariantId = String(input.productVariantId);
    const inventoryBatchId = typeof input.inventoryBatchId === "string" ? input.inventoryBatchId : undefined;

    assertBranchAccess(auth, branchId);

    return prisma.$transaction(async (tx) => {
      await tx.productVariant.findFirstOrThrow({
        where: {
          id: productVariantId,
          organizationId: auth.organizationId
        }
      });

      await ensureBatchAccess(tx, auth, {
        branchId,
        productVariantId,
        inventoryBatchId
      });

      const reportIndex = await tx.stockIssueReport.count({
        where: { organizationId: auth.organizationId }
      });

      const issue = await tx.stockIssueReport.create({
        data: {
          organizationId: auth.organizationId,
          branchId,
          reportNumber: `SIR-${String(reportIndex + 1).padStart(6, "0")}`,
          productVariantId,
          inventoryBatchId: inventoryBatchId || null,
          quantity: Number(input.quantity),
          issueType: input.issueType as StockIssueType,
          reportedById: auth.userId,
          status: StockIssueReportStatus.SUBMITTED,
          description: String(input.description),
          evidenceUrl: typeof input.evidenceUrl === "string" ? input.evidenceUrl : null,
          notes: typeof input.notes === "string" ? input.notes : null
        }
      });

      await auditService.create(
        {
          organizationId: auth.organizationId,
          branchId,
          userId: auth.userId,
          action: "stock_issue.create",
          entityType: "StockIssueReport",
          entityId: issue.id,
          requestId: request.requestContext?.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          afterData: issue
        },
        tx
      );

      return this.get(auth, issue.id);
    });
  },

  async review(auth: AuthContext, id: string, input: Record<string, unknown>, request: Request) {
    const issue = await this.get(auth, id);

    if (issue.status !== StockIssueReportStatus.SUBMITTED && issue.status !== StockIssueReportStatus.UNDER_REVIEW) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "This stock issue can no longer be reviewed", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.stockIssueReport.update({
      where: { id: issue.id },
      data: {
        status: input.status as StockIssueReportStatus,
        reviewedById: auth.userId,
        reviewedAt: new Date(),
        notes: typeof input.notes === "string" ? input.notes : issue.notes
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: issue.branchId,
      userId: auth.userId,
      action: "stock_issue.review",
      entityType: "StockIssueReport",
      entityId: issue.id,
      requestId: request.requestContext?.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: issue,
      afterData: updated
    });

    return updated;
  },

  async reject(auth: AuthContext, id: string, input: Record<string, unknown>, request: Request) {
    const issue = await this.get(auth, id);

    if (
      issue.status !== StockIssueReportStatus.SUBMITTED &&
      issue.status !== StockIssueReportStatus.UNDER_REVIEW &&
      issue.status !== StockIssueReportStatus.ACCEPTED
    ) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "This stock issue cannot be rejected", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.stockIssueReport.update({
      where: { id: issue.id },
      data: {
        status: StockIssueReportStatus.REJECTED,
        reviewedById: auth.userId,
        reviewedAt: new Date(),
        notes: `${issue.notes ? `${issue.notes}\n` : ""}Rejected: ${String(input.reason)}`.trim()
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: issue.branchId,
      userId: auth.userId,
      action: "stock_issue.reject",
      entityType: "StockIssueReport",
      entityId: issue.id,
      requestId: request.requestContext?.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: issue,
      afterData: updated
    });

    return updated;
  },

  async convertToAdjustment(auth: AuthContext, id: string, input: Record<string, unknown>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const issue = await tx.stockIssueReport.findFirst({
        where: {
          id,
          ...getIssueWhere(auth)
        },
        include: {
          productVariant: true
        }
      });

      if (!issue) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Stock issue not found", StatusCodes.NOT_FOUND);
      }

      if (issue.linkedStockAdjustmentId) {
        throw new AppError(
          ERROR_CODES.DUPLICATE_IDEMPOTENCY_KEY,
          "This stock issue has already been converted to an adjustment",
          StatusCodes.CONFLICT
        );
      }

      if (issue.status !== StockIssueReportStatus.ACCEPTED) {
        throw new AppError(
          ERROR_CODES.INVALID_STATUS_TRANSITION,
          "Only accepted stock issues can be converted to adjustments",
          StatusCodes.BAD_REQUEST
        );
      }

      const adjustmentIndex = await tx.stockAdjustment.count({
        where: { organizationId: auth.organizationId }
      });

      const adjustment = await tx.stockAdjustment.create({
        data: {
          organizationId: auth.organizationId,
          branchId: issue.branchId,
          adjustmentNumber: `ADJ-${String(adjustmentIndex + 1).padStart(6, "0")}`,
          adjustmentType: mapIssueTypeToAdjustmentType(issue.issueType),
          createdById: auth.userId,
          sourceStockIssueId: issue.id,
          reason: issue.description || `Issue report ${issue.reportNumber}`,
          notes: typeof input.notes === "string" ? input.notes : issue.notes
        }
      });

      const resolvedCost = (input && typeof input.unitCost === "number")
        ? (input.unitCost as number)
        : Number(issue.productVariant.defaultCost);

      await tx.stockAdjustmentItem.create({
        data: {
          stockAdjustmentId: adjustment.id,
          productVariantId: issue.productVariantId,
          inventoryBatchId: issue.inventoryBatchId,
          direction: issue.issueType === "FOUND_STOCK" ? "INCREASE" : "DECREASE",
          quantity: issue.quantity,
          unitCost: resolvedCost,
          unitCostSnapshot: resolvedCost,
          notes: issue.notes
        }
      });

      const updatedIssue = await tx.stockIssueReport.update({
        where: { id: issue.id },
        data: {
          status: StockIssueReportStatus.CONVERTED_TO_ADJUSTMENT,
          reviewedById: auth.userId,
          reviewedAt: new Date(),
          linkedStockAdjustmentId: adjustment.id
        }
      });

      await auditService.create(
        {
          organizationId: auth.organizationId,
          branchId: issue.branchId,
          userId: auth.userId,
          action: "stock_issue.convert_to_adjustment",
          entityType: "StockIssueReport",
          entityId: issue.id,
          requestId: request.requestContext?.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          beforeData: issue,
          afterData: updatedIssue,
          metadata: {
            stockAdjustmentId: adjustment.id
          }
        },
        tx
      );

      return {
        issue: updatedIssue,
        stockAdjustment: adjustment
      };
    });
  }
};
