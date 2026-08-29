import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";

const getTargetWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
  };
};

export const targetsService = {
  async list(auth: AuthContext) {
    return prisma.salesTarget.findMany({
      where: getTargetWhere(auth),
      include: {
        branch: true,
        user: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getPerformance(auth: AuthContext, id: string) {
    const target = await prisma.salesTarget.findFirst({
      where: { id, ...getTargetWhere(auth) },
      include: {
        branch: true,
        user: true
      }
    });

    if (!target) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Target not found", StatusCodes.NOT_FOUND);
    }

    const start = new Date(target.startDate);
    const end = new Date(target.endDate);

    let currentProgress = 0;

    if (target.targetType === "BRANCH") {
      if (!target.branchId) throw new AppError(ERROR_CODES.BAD_REQUEST, "Branch target must have a branchId", StatusCodes.BAD_REQUEST);

      const salesAgg = await prisma.sale.aggregate({
        where: {
          organizationId: auth.organizationId,
          branchId: target.branchId,
          createdAt: { gte: start, lte: end },
          status: "COMPLETED"
        },
        _sum: {
          totalAmount: true
        }
      });
      currentProgress = salesAgg?._sum?.totalAmount ? Number(salesAgg._sum.totalAmount) : 0;
    } else {
      if (!target.userId) throw new AppError(ERROR_CODES.BAD_REQUEST, "User target must have a userId", StatusCodes.BAD_REQUEST);

      const salesAgg = await prisma.sale.aggregate({
        where: {
          organizationId: auth.organizationId,
          attendantId: target.userId,
          createdAt: { gte: start, lte: end },
          status: "COMPLETED"
        },
        _sum: {
          totalAmount: true
        }
      });
      currentProgress = salesAgg?._sum?.totalAmount ? Number(salesAgg._sum.totalAmount) : 0;
    }

    const targetVal = Number(target.targetValue);
    const percentage = targetVal > 0 ? (currentProgress / targetVal) * 100 : 0;
    const remaining = Math.max(0, targetVal - currentProgress);

    return {
      target,
      performance: {
        targetValue: targetVal,
        currentProgress: Math.round(currentProgress * 100) / 100,
        percentage: Math.round(percentage * 100) / 100,
        remainingAmount: Math.round(remaining * 100) / 100,
        isAchieved: currentProgress >= targetVal
      }
    };
  },

  async getMyPerformance(auth: AuthContext, query: Record<string, any>) {
    const end = query.endDate ? new Date(String(query.endDate)) : new Date();
    const start = query.startDate ? new Date(String(query.startDate)) : new Date(end.getFullYear(), end.getMonth(), 1);
    const saleWhere: Prisma.SaleWhereInput = {
      organizationId: auth.organizationId,
      attendantId: auth.userId,
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] },
      completedAt: { gte: start, lte: end }
    };
    const [sales, items, attendance, shifts, returns, target] = await Promise.all([
      prisma.sale.aggregate({ where: saleWhere, _count: { id: true }, _sum: { totalAmount: true, lineDiscountAmount: true, subtotal: true } }),
      prisma.saleItem.aggregate({ where: { sale: saleWhere }, _sum: { quantity: true } }),
      prisma.attendance.aggregate({
        where: { organizationId: auth.organizationId, userId: auth.userId, checkedInAt: { gte: start, lte: end } },
        _count: { id: true }
      }),
      prisma.shift.groupBy({
        by: ["status"], where: { organizationId: auth.organizationId, userId: auth.userId, openedAt: { gte: start, lte: end } },
        _count: { id: true }
      }),
      prisma.returnRequest.count({
        where: { organizationId: auth.organizationId, requestedById: auth.userId, requestedAt: { gte: start, lte: end } }
      }),
      prisma.salesTarget.findFirst({
        where: { organizationId: auth.organizationId, userId: auth.userId, startDate: { lte: end }, endDate: { gte: start }, status: "ACTIVE" },
        orderBy: { endDate: "asc" }
      })
    ]);
    const transactions = sales._count.id;
    const revenue = Number(sales._sum.totalAmount ?? 0);
    const subtotal = Number(sales._sum.subtotal ?? 0);
    const discounts = Number(sales._sum.lineDiscountAmount ?? 0);
    const closedShifts = shifts.filter((shift) => shift.status === "CLOSED").reduce((sum, shift) => sum + shift._count.id, 0);
    const totalShifts = shifts.reduce((sum, shift) => sum + shift._count.id, 0);
    return {
      period: { start, end },
      sales: revenue,
      transactions,
      units: Number(items._sum.quantity ?? 0),
      averageSale: transactions ? revenue / transactions : 0,
      target: target ? { value: Number(target.targetValue), progress: revenue, percentage: Number(target.targetValue) ? (revenue / Number(target.targetValue)) * 100 : 0 } : null,
      attendanceDays: attendance._count.id,
      shiftComplianceRate: totalShifts ? (closedShifts / totalShifts) * 100 : 0,
      returnRate: transactions ? (returns / transactions) * 100 : 0,
      discountRate: subtotal ? (discounts / subtotal) * 100 : 0
    };
  },

  async getAttendantPerformance(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const end = query.endDate ? new Date(String(query.endDate)) : new Date();
    const start = query.startDate ? new Date(String(query.startDate)) : new Date(end.getFullYear(), end.getMonth(), 1);
    const users = await prisma.user.findMany({
      where: {
        organizationId: auth.organizationId,
        role: "SALES_ATTENDANT",
        ...(scope.branchIds ? { branchAssignments: { some: { branchId: { in: scope.branchIds } } } } : {})
      },
      select: { id: true, firstName: true, lastName: true, branchAssignments: { select: { branch: { select: { id: true, name: true } } } } }
    });
    return Promise.all(users.map(async (user) => {
      const sales = await prisma.sale.aggregate({
        where: {
          organizationId: auth.organizationId, attendantId: user.id,
          ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
          status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] }, completedAt: { gte: start, lte: end }
        },
        _count: { id: true }, _sum: { totalAmount: true }
      });
      const revenue = Number(sales._sum.totalAmount ?? 0);
      return {
        id: user.id, firstName: user.firstName, lastName: user.lastName,
        branches: user.branchAssignments.map((assignment) => assignment.branch),
        transactions: sales._count.id, revenue,
        averageSale: sales._count.id ? revenue / sales._count.id : 0
      };
    }));
  },

  async create(auth: AuthContext, input: Record<string, any>, request: Request) {
    const target = await prisma.salesTarget.create({
      data: {
        organizationId: auth.organizationId,
        targetType: input.targetType,
        targetValue: input.targetValue,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        branchId: input.branchId || null,
        userId: input.userId || null
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: input.branchId || undefined,
      userId: auth.userId,
      action: "target.create",
      entityType: "SalesTarget",
      entityId: target.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      afterData: target
    });

    return target;
  }
};
