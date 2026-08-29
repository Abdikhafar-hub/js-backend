import { Prisma, ShiftStatus, AttendanceStatus, ExpenseStatus, ShiftCashMovementType, DailyBranchReconciliationStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";

const getShiftWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  const where: any = { organizationId: scope.organizationId };
  if (scope.branchIds) where.branchId = { in: scope.branchIds };
  if (auth.role === "SALES_ATTENDANT") where.userId = auth.userId;
  return where;
};

export const shiftsService = {
  // ==========================================
  // SHIFT LISTING
  // ==========================================

  async listShifts(auth: AuthContext, query: Record<string, any>) {
    const where: any = getShiftWhere(auth);
    if (query.status) where.status = query.status;
    if (query.branchId) { assertBranchAccess(auth, query.branchId); where.branchId = query.branchId; }
    if (query.userId && auth.role !== "SALES_ATTENDANT") where.userId = query.userId;

    const shifts = await prisma.shift.findMany({
      where,
      include: { branch: true, user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { openedAt: "desc" },
      take: 50
    });
    return shifts;
  },

  async getCurrentShift(auth: AuthContext) {
    const shift = await prisma.shift.findFirst({
      where: { userId: auth.userId!, status: ShiftStatus.OPEN },
      include: {
        branch: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        cashMovements: { orderBy: { createdAt: "desc" } },
        sales: { where: { status: "COMPLETED" }, select: { id: true, totalAmount: true, paymentStatus: true } },
        expenses: { select: { id: true, amount: true, status: true } }
      }
    });
    return shift;
  },

  async getShiftById(auth: AuthContext, id: string) {
    const where: any = { id, ...getShiftWhere(auth) };
    delete where.userId; // GM/BM can view any shift in scope
    if (auth.role === "SALES_ATTENDANT") where.userId = auth.userId;

    const shift = await prisma.shift.findFirst({
      where,
      include: {
        branch: true,
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        cashMovements: { orderBy: { createdAt: "asc" } },
        sales: { where: { status: "COMPLETED" }, select: { id: true, saleNumber: true, totalAmount: true, amountPaid: true, createdAt: true } },
        expenses: { include: { category: true } },
        payments: { select: { id: true, amount: true, paymentMethod: true, status: true, createdAt: true } }
      }
    });

    if (!shift) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shift not found", StatusCodes.NOT_FOUND);
    return shift;
  },

  // ==========================================
  // ATTENDANCE
  // ==========================================

  async clockIn(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);
    const active = await prisma.attendance.findFirst({ where: { userId: auth.userId!, checkedOutAt: null } });
    if (active) throw new AppError(ERROR_CODES.BAD_REQUEST, "User is already clocked in", StatusCodes.BAD_REQUEST);

    const attendance = await prisma.attendance.create({
      data: {
        organizationId: auth.organizationId,
        userId: auth.userId!,
        branchId: input.branchId,
        checkedInAt: new Date(),
        status: AttendanceStatus.PRESENT,
        notes: input.notes || null
      }
    });

    await auditService.create({
      organizationId: auth.organizationId, branchId: input.branchId, userId: auth.userId,
      action: "attendance.clock_in", entityType: "Attendance", entityId: attendance.id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), afterData: attendance
    });
    return attendance;
  },

  async clockOut(auth: AuthContext, request: Request) {
    const active = await prisma.attendance.findFirst({ where: { userId: auth.userId!, checkedOutAt: null } });
    if (!active) throw new AppError(ERROR_CODES.BAD_REQUEST, "No active clock-in session found", StatusCodes.BAD_REQUEST);

    const updated = await prisma.attendance.update({ where: { id: active.id }, data: { checkedOutAt: new Date() } });

    await auditService.create({
      organizationId: auth.organizationId, branchId: active.branchId, userId: auth.userId,
      action: "attendance.clock_out", entityType: "Attendance", entityId: active.id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: active, afterData: updated
    });
    return updated;
  },

  async listAttendance(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const where: any = { organizationId: scope.organizationId };
    if (scope.branchIds) where.branchId = { in: scope.branchIds };
    if (auth.role === "SALES_ATTENDANT") where.userId = auth.userId;
    if (query.branchId) { assertBranchAccess(auth, query.branchId); where.branchId = query.branchId; }
    if (query.userId && auth.role !== "SALES_ATTENDANT") where.userId = query.userId;

    return prisma.attendance.findMany({
      where,
      include: {
        branch: true,
        user: { select: { id: true, firstName: true, lastName: true, role: true } }
      },
      orderBy: { checkedInAt: "desc" },
      take: 100
    });
  },

  async getMyAttendance(auth: AuthContext) {
    const active = await prisma.attendance.findFirst({ where: { userId: auth.userId!, checkedOutAt: null } });
    const recent = await prisma.attendance.findMany({
      where: { userId: auth.userId! },
      include: { branch: true },
      orderBy: { checkedInAt: "desc" },
      take: 30
    });
    return { active, recent };
  },

  // ==========================================
  // SHIFTS
  // ==========================================

  async startShift(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);
    const active = await prisma.shift.findFirst({ where: { userId: auth.userId!, status: { in: [ShiftStatus.OPEN, ShiftStatus.CLOSING_PENDING, ShiftStatus.REVIEW_REQUIRED] } } });
    if (active) throw new AppError(ERROR_CODES.BAD_REQUEST, "You already have an open shift", StatusCodes.BAD_REQUEST);

    const shiftNumber = `SFT-${Date.now()}`;
    return prisma.$transaction(async (tx) => {
      const shift = await tx.shift.create({
        data: {
          organizationId: auth.organizationId, branchId: input.branchId, userId: auth.userId!,
          shiftNumber, openedAt: new Date(), openingCash: input.openingFloat, status: ShiftStatus.OPEN
        }
      });
      await tx.shiftCashMovement.create({
        data: { shiftId: shift.id, movementType: ShiftCashMovementType.OPENING_FLOAT, amount: input.openingFloat, reference: shift.shiftNumber }
      });
      await auditService.create({
        organizationId: auth.organizationId, branchId: input.branchId, userId: auth.userId,
        action: "shift.start", entityType: "Shift", entityId: shift.id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), afterData: shift
      }, tx);
      return shift;
    });
  },

  async recordCashMovement(auth: AuthContext, shiftId: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({ where: { id: shiftId, userId: auth.userId!, status: ShiftStatus.OPEN } });
      if (!shift) throw new AppError(ERROR_CODES.BAD_REQUEST, "Active shift not found", StatusCodes.BAD_REQUEST);

      const movement = await tx.shiftCashMovement.create({
        data: { shiftId: shift.id, movementType: input.movementType, amount: input.amount, reference: input.reference || null, notes: input.reason || null }
      });

      await auditService.create({
        organizationId: auth.organizationId, branchId: shift.branchId, userId: auth.userId,
        action: "shift.cash_movement", entityType: "ShiftCashMovement", entityId: movement.id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), afterData: movement
      }, tx);
      return movement;
    });
  },

  async endShift(auth: AuthContext, shiftId: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({ where: { id: shiftId, userId: auth.userId!, status: ShiftStatus.OPEN } });
      if (!shift) throw new AppError(ERROR_CODES.BAD_REQUEST, "Active shift not found", StatusCodes.BAD_REQUEST);

      const movements = await tx.shiftCashMovement.findMany({ where: { shiftId: shift.id } });
      const expectedCash = movements.reduce((total, movement) => {
        const amount = Number(movement.amount);
        if (movement.movementType === ShiftCashMovementType.OPENING_FLOAT || movement.movementType === ShiftCashMovementType.CASH_SALE || movement.movementType === ShiftCashMovementType.CASH_IN) return total + amount;
        if (movement.movementType === ShiftCashMovementType.CASH_REFUND || movement.movementType === ShiftCashMovementType.CASH_EXPENSE || movement.movementType === ShiftCashMovementType.CASH_OUT || movement.movementType === ShiftCashMovementType.BANKING) return total - amount;
        return total + amount;
      }, 0);
      const cashVariance = input.declaredCash - expectedCash;
      const requiresReview = Math.abs(cashVariance) > 0.01;

      const updated = await tx.shift.update({
        where: { id: shift.id },
        data: {
          closedAt: requiresReview ? null : new Date(), declaredCash: input.declaredCash, expectedCash, cashVariance,
          status: requiresReview ? ShiftStatus.REVIEW_REQUIRED : ShiftStatus.CLOSED, notes: input.notes || null
        }
      });

      await auditService.create({
        organizationId: auth.organizationId, branchId: shift.branchId, userId: auth.userId,
        action: "shift.end", entityType: "Shift", entityId: shift.id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), beforeData: shift, afterData: updated
      }, tx);
      return updated;
    });
  },

  async reviewShift(auth: AuthContext, shiftId: string, request: Request) {
    const scope = buildUserScope(auth);
    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, organizationId: scope.organizationId, ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}) }
    });
    if (!shift) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shift not found", StatusCodes.NOT_FOUND);
    if (shift.status !== ShiftStatus.REVIEW_REQUIRED && shift.status !== ShiftStatus.CLOSING_PENDING) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Shift is not awaiting review", StatusCodes.CONFLICT);
    }
    if (shift.userId === auth.userId) throw new AppError(ERROR_CODES.ACCESS_DENIED, "You cannot review your own shift", StatusCodes.FORBIDDEN);
    const updated = await prisma.shift.update({ where: { id: shift.id }, data: { status: ShiftStatus.CLOSED, closedAt: new Date() } });
    await auditService.create({
      organizationId: auth.organizationId, branchId: shift.branchId, userId: auth.userId,
      action: "shift.review_close", entityType: "Shift", entityId: shift.id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: shift, afterData: updated
    });
    return updated;
  },

  // ==========================================
  // EXPENSE CATEGORIES
  // ==========================================

  async listExpenseCategories(auth: AuthContext) {
    return prisma.expenseCategory.findMany({
      where: { organizationId: auth.organizationId },
      orderBy: { name: "asc" }
    });
  },

  async createExpenseCategory(auth: AuthContext, input: Record<string, any>, request: Request) {
    const category = await prisma.expenseCategory.create({
      data: { organizationId: auth.organizationId, name: input.name, description: input.description || null }
    });
    await auditService.create({
      organizationId: auth.organizationId, userId: auth.userId,
      action: "expense_category.create", entityType: "ExpenseCategory", entityId: category.id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), afterData: category
    });
    return category;
  },

  // ==========================================
  // EXPENSES
  // ==========================================

  async listExpenses(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const where: any = { organizationId: scope.organizationId };
    if (scope.branchIds) where.branchId = { in: scope.branchIds };
    if (query.status) where.status = query.status;
    if (query.branchId) { assertBranchAccess(auth, query.branchId); where.branchId = query.branchId; }

    return prisma.expense.findMany({
      where,
      include: {
        branch: true, category: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  },

  async getExpenseById(auth: AuthContext, id: string) {
    const scope = buildUserScope(auth);
    const expense = await prisma.expense.findFirst({
      where: { id, organizationId: auth.organizationId, ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}) },
      include: {
        branch: true, category: true, shift: true,
        createdBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        approvals: { include: { approvedBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" } }
      }
    });
    if (!expense) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Expense not found", StatusCodes.NOT_FOUND);
    return expense;
  },

  async createExpense(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);
    const count = await prisma.expense.count({ where: { organizationId: auth.organizationId } });
    const expenseNumber = `EXP-${(count + 1).toString().padStart(6, "0")}`;

    const expense = await prisma.expense.create({
      data: {
        organizationId: auth.organizationId, branchId: input.branchId, categoryId: input.categoryId,
        expenseNumber, amount: input.amount, description: input.description,
        paymentMethod: input.paymentMethod, notes: input.notes || null,
        status: ExpenseStatus.SUBMITTED, createdById: auth.userId!, shiftId: input.shiftId || null
      }
    });

    await auditService.create({
      organizationId: auth.organizationId, branchId: input.branchId, userId: auth.userId,
      action: "expense.create", entityType: "Expense", entityId: expense.id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), afterData: expense
    });
    return expense;
  },

  async approveExpense(auth: AuthContext, id: string, request: Request) {
    const expense = await prisma.expense.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!expense) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Expense not found", StatusCodes.NOT_FOUND);
    assertBranchAccess(auth, expense.branchId ?? "");
    if (expense.status !== ExpenseStatus.SUBMITTED) throw new AppError(ERROR_CODES.BAD_REQUEST, "Expense must be in SUBMITTED status", StatusCodes.BAD_REQUEST);
    if (expense.createdById === auth.userId) throw new AppError(ERROR_CODES.ACCESS_DENIED, "You cannot approve your own expense", StatusCodes.FORBIDDEN);
    if (auth.role === "BRANCH_MANAGER") {
      const settings = await prisma.organizationSetting.findUnique({ where: { organizationId: auth.organizationId } });
      if (Number(expense.amount) > Number(settings?.maximumBranchManagerExpense ?? 0)) {
        throw new AppError(ERROR_CODES.ACCESS_DENIED, "Expense exceeds the Branch Manager approval limit", StatusCodes.FORBIDDEN);
      }
    }

    const updated = await prisma.expense.update({ where: { id }, data: { status: ExpenseStatus.APPROVED, approvedById: auth.userId } });
    await prisma.expenseApproval.create({ data: { expenseId: id, approvedById: auth.userId!, status: "APPROVED" } });

    await auditService.create({
      organizationId: auth.organizationId, branchId: expense.branchId, userId: auth.userId,
      action: "expense.approve", entityType: "Expense", entityId: id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: expense, afterData: updated
    });
    return updated;
  },

  async rejectExpense(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    const expense = await prisma.expense.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!expense) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Expense not found", StatusCodes.NOT_FOUND);
    assertBranchAccess(auth, expense.branchId ?? "");

    const updated = await prisma.expense.update({ where: { id }, data: { status: ExpenseStatus.REJECTED, notes: input.reason } });
    await prisma.expenseApproval.create({ data: { expenseId: id, approvedById: auth.userId!, status: "REJECTED", notes: input.reason } });

    await auditService.create({
      organizationId: auth.organizationId, branchId: expense.branchId, userId: auth.userId,
      action: "expense.reject", entityType: "Expense", entityId: id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: expense, afterData: updated
    });
    return updated;
  },

  async payExpense(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const expense = await tx.expense.findFirst({
        where: { id, organizationId: auth.organizationId, ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}) }
      });
      if (!expense) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Expense not found", StatusCodes.NOT_FOUND);
      assertBranchAccess(auth, expense.branchId ?? "");
      if (expense.status !== ExpenseStatus.APPROVED) throw new AppError(ERROR_CODES.BAD_REQUEST, "Expense must be APPROVED before payment", StatusCodes.BAD_REQUEST);
      if (!expense.branchId) throw new AppError(ERROR_CODES.BAD_REQUEST, "Expense has no settlement branch", StatusCodes.BAD_REQUEST);
      if (["MPESA", "CARD", "BANK_TRANSFER"].includes(expense.paymentMethod) && !input.providerReference) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "A provider or bank reference is required", StatusCodes.BAD_REQUEST);
      }

      let shiftId = expense.shiftId;
      if (expense.paymentMethod === "CASH") {
        const shift = await tx.shift.findFirst({
          where: { id: shiftId ?? undefined, organizationId: auth.organizationId, branchId: expense.branchId, status: ShiftStatus.OPEN }
        }) ?? await tx.shift.findFirst({
          where: { organizationId: auth.organizationId, branchId: expense.branchId, userId: auth.userId, status: ShiftStatus.OPEN }
        });
        if (!shift) throw new AppError(ERROR_CODES.SHIFT_NOT_OPEN, "Cash expense requires an open shift", StatusCodes.CONFLICT);
        shiftId = shift.id;
        await tx.shiftCashMovement.create({
          data: { shiftId, movementType: ShiftCashMovementType.CASH_EXPENSE, amount: expense.amount, reference: expense.expenseNumber }
        });
      }
      const paymentCount = await tx.payment.count({ where: { organizationId: auth.organizationId } });
      const payment = await tx.payment.create({
        data: {
          organizationId: auth.organizationId, branchId: expense.branchId,
          paymentNumber: `PMT-${(paymentCount + 1).toString().padStart(6, "0")}`,
          shiftId, direction: "OUTGOING", paymentMethod: expense.paymentMethod,
          amount: expense.amount, currencyCode: "KES", reference: input.providerReference ?? expense.expenseNumber,
          status: "COMPLETED", receivedById: auth.userId, receivedAt: new Date(),
          idempotencyKey: `expense:${expense.id}`,
          metadata: { expenseId: expense.id, expenseNumber: expense.expenseNumber }
        }
      });
      const updated = await tx.expense.update({ where: { id }, data: { status: ExpenseStatus.PAID, paidAt: new Date(), shiftId } });
      await auditService.create({
        organizationId: auth.organizationId, branchId: expense.branchId, userId: auth.userId,
        action: "expense.pay", entityType: "Expense", entityId: id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), beforeData: expense, afterData: { expense: updated, paymentId: payment.id }
      }, tx);
      return updated;
    });
  },

  async reverseExpense(auth: AuthContext, id: string, request: Request) {
    const expense = await prisma.expense.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!expense) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Expense not found", StatusCodes.NOT_FOUND);
    if (auth.role !== "GENERAL_MANAGER") throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only a General Manager can reverse an expense", StatusCodes.FORBIDDEN);
    assertBranchAccess(auth, expense.branchId ?? "");
    if (expense.status !== ExpenseStatus.PAID) throw new AppError(ERROR_CODES.BAD_REQUEST, "Only PAID expenses can be reversed", StatusCodes.BAD_REQUEST);

    return prisma.$transaction(async (tx) => {
      if (!expense.branchId) throw new AppError(ERROR_CODES.BAD_REQUEST, "Expense has no settlement branch", StatusCodes.BAD_REQUEST);
      const settlement = await tx.payment.findFirst({
        where: { organizationId: auth.organizationId, idempotencyKey: `expense:${expense.id}`, status: "COMPLETED" }
      });
      if (!settlement) throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Expense settlement record is missing", StatusCodes.CONFLICT);
      const count = await tx.payment.count({ where: { organizationId: auth.organizationId } });
      const reversal = await tx.payment.create({
        data: {
          organizationId: auth.organizationId, branchId: expense.branchId,
          paymentNumber: `PMT-${(count + 1).toString().padStart(6, "0")}`,
          direction: "INCOMING", paymentMethod: expense.paymentMethod, amount: expense.amount,
          currencyCode: settlement.currencyCode, reference: `REV-${settlement.paymentNumber}`,
          status: "COMPLETED", receivedById: auth.userId, receivedAt: new Date(),
          idempotencyKey: `expense-reversal:${expense.id}`, metadata: { expenseId: expense.id, reversedPaymentId: settlement.id }
        }
      });
      await tx.payment.update({ where: { id: settlement.id }, data: { status: "REVERSED", reversedAt: new Date(), reversalReason: "Expense reversed" } });
      const updated = await tx.expense.update({ where: { id }, data: { status: ExpenseStatus.REVERSED } });
      await auditService.create({
        organizationId: auth.organizationId, branchId: expense.branchId, userId: auth.userId,
        action: "expense.reverse", entityType: "Expense", entityId: id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), beforeData: expense, afterData: { expense: updated, reversalPaymentId: reversal.id }
      }, tx);
      return updated;
    });
  },

  // ==========================================
  // DAILY RECONCILIATION
  // ==========================================

  async listReconciliations(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const where: any = { organizationId: scope.organizationId };
    if (scope.branchIds) where.branchId = { in: scope.branchIds };
    if (query.branchId) { assertBranchAccess(auth, query.branchId); where.branchId = query.branchId; }
    if (query.status) where.status = query.status;

    return prisma.dailyBranchReconciliation.findMany({
      where,
      include: { branch: true },
      orderBy: { reconciliationDate: "desc" },
      take: 100
    });
  },

  async getReconciliationById(auth: AuthContext, id: string) {
    const scope = buildUserScope(auth);
    const rec = await prisma.dailyBranchReconciliation.findFirst({
      where: { id, organizationId: auth.organizationId, ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}) },
      include: { branch: true }
    });
    if (!rec) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Reconciliation not found", StatusCodes.NOT_FOUND);
    return rec;
  },

  async reconcileDailyBranch(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);
    return prisma.$transaction(async (tx) => {
      const targetDate = new Date(input.date);
      const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

      const paymentWhere = { direction: "INCOMING" as const, saleId: { not: null }, receivedAt: { gte: startOfDay, lte: endOfDay }, branchId: input.branchId, status: "COMPLETED" as const };
      const cashAgg = await tx.payment.aggregate({ where: { ...paymentWhere, paymentMethod: "CASH" }, _sum: { amount: true } });
      const mpesaAgg = await tx.payment.aggregate({ where: { ...paymentWhere, paymentMethod: "MPESA" }, _sum: { amount: true } });
      const cardAgg = await tx.payment.aggregate({ where: { ...paymentWhere, paymentMethod: "CARD" }, _sum: { amount: true } });
      const bankAgg = await tx.payment.aggregate({ where: { ...paymentWhere, paymentMethod: "BANK_TRANSFER" }, _sum: { amount: true } });
      const expenseAgg = await tx.expense.aggregate({ where: { status: ExpenseStatus.PAID, paidAt: { gte: startOfDay, lte: endOfDay }, branchId: input.branchId }, _sum: { amount: true } });
      const refundAgg = await tx.refund.aggregate({ where: { status: "COMPLETED", completedAt: { gte: startOfDay, lte: endOfDay }, branchId: input.branchId }, _sum: { amount: true } });
      const cashRefundAgg = await tx.refund.aggregate({ where: { status: "COMPLETED", method: "CASH", completedAt: { gte: startOfDay, lte: endOfDay }, branchId: input.branchId }, _sum: { amount: true } });
      const movements = await tx.shiftCashMovement.findMany({
        where: { shift: { organizationId: auth.organizationId, branchId: input.branchId }, createdAt: { gte: startOfDay, lte: endOfDay } }
      });

      const totalCash = cashAgg._sum.amount ? Number(cashAgg._sum.amount) : 0;
      const totalMpesa = mpesaAgg._sum.amount ? Number(mpesaAgg._sum.amount) : 0;
      const totalCard = cardAgg._sum.amount ? Number(cardAgg._sum.amount) : 0;
      const totalBank = bankAgg._sum.amount ? Number(bankAgg._sum.amount) : 0;
      const totalExpenses = expenseAgg._sum.amount ? Number(expenseAgg._sum.amount) : 0;
      const totalRefunds = Number(refundAgg._sum.amount ?? 0);
      const cashRefunds = Number(cashRefundAgg._sum.amount ?? 0);
      const netCashMovements = movements.reduce((total, movement) => {
        const amount = Number(movement.amount);
        if (movement.movementType === ShiftCashMovementType.OPENING_FLOAT || movement.movementType === ShiftCashMovementType.CASH_IN) return total + amount;
        if (movement.movementType === ShiftCashMovementType.CASH_OUT || movement.movementType === ShiftCashMovementType.BANKING) return total - amount;
        return total;
      }, 0);
      const totalSales = totalCash + totalMpesa + totalCard + totalBank;
      const expectedCash = totalCash + netCashMovements - cashRefunds - totalExpenses;
      const cashVariance = input.declaredCash - expectedCash;

      const existing = await tx.dailyBranchReconciliation.findUnique({
        where: { organizationId_branchId_reconciliationDate: { organizationId: auth.organizationId, branchId: input.branchId, reconciliationDate: startOfDay } }
      });
      if (existing && existing.status !== DailyBranchReconciliationStatus.DRAFT && existing.status !== DailyBranchReconciliationStatus.REVIEW_REQUIRED) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "This reconciliation has already been submitted", StatusCodes.CONFLICT);
      }
      const data = {
        totalCompletedSales: totalSales, cashSales: totalCash, mpesaSales: totalMpesa,
        cardSales: totalCard, bankTransferSales: totalBank, expenses: totalExpenses,
        refunds: totalRefunds, cashRefunds, cashMovements: netCashMovements,
        expectedCash, declaredCash: input.declaredCash, cashVariance,
        notes: input.notes || null, status: DailyBranchReconciliationStatus.SUBMITTED,
        submittedById: auth.userId, approvedById: null
      };
      const reconciliation = existing
        ? await tx.dailyBranchReconciliation.update({ where: { id: existing.id }, data })
        : await tx.dailyBranchReconciliation.create({
        data: {
          organizationId: auth.organizationId, branchId: input.branchId, reconciliationDate: startOfDay,
          ...data
        }
      });

      await auditService.create({
        organizationId: auth.organizationId, branchId: input.branchId, userId: auth.userId,
        action: "branch.reconcile", entityType: "DailyBranchReconciliation", entityId: reconciliation.id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), afterData: reconciliation
      }, tx);
      return reconciliation;
    });
  },

  async approveReconciliation(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    const rec = await prisma.dailyBranchReconciliation.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!rec) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Reconciliation not found", StatusCodes.NOT_FOUND);
    if (auth.role !== "GENERAL_MANAGER") throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only a General Manager can approve reconciliation", StatusCodes.FORBIDDEN);
    if (rec.submittedById === auth.userId) throw new AppError(ERROR_CODES.ACCESS_DENIED, "You cannot approve your own reconciliation", StatusCodes.FORBIDDEN);
    if (rec.status !== DailyBranchReconciliationStatus.SUBMITTED) throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only submitted reconciliation can be approved", StatusCodes.CONFLICT);

    const updated = await prisma.dailyBranchReconciliation.update({
      where: { id }, data: { status: DailyBranchReconciliationStatus.APPROVED, approvedById: auth.userId, notes: input.notes || rec.notes }
    });

    await auditService.create({
      organizationId: auth.organizationId, branchId: rec.branchId, userId: auth.userId,
      action: "reconciliation.approve", entityType: "DailyBranchReconciliation", entityId: id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: rec, afterData: updated
    });
    return updated;
  },

  async returnReconciliation(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    const rec = await prisma.dailyBranchReconciliation.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!rec) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Reconciliation not found", StatusCodes.NOT_FOUND);
    if (auth.role !== "GENERAL_MANAGER") throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only a General Manager can return reconciliation", StatusCodes.FORBIDDEN);
    if (rec.status !== DailyBranchReconciliationStatus.SUBMITTED) throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only submitted reconciliation can be returned", StatusCodes.CONFLICT);
    const updated = await prisma.dailyBranchReconciliation.update({
      where: { id },
      data: { status: DailyBranchReconciliationStatus.REVIEW_REQUIRED, approvedById: null, notes: input.notes || rec.notes }
    });
    await auditService.create({
      organizationId: auth.organizationId, branchId: rec.branchId, userId: auth.userId,
      action: "reconciliation.return", entityType: "DailyBranchReconciliation", entityId: id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: rec, afterData: updated
    });
    return updated;
  }
};
