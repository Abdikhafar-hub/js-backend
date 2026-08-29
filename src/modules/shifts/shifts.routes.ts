import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { shiftsController } from "./shifts.controller.js";
import {
  startShiftSchema,
  recordShiftCashSchema,
  endShiftSchema,
  clockInSchema,
  createExpenseSchema,
  createExpenseCategorySchema,
  rejectExpenseSchema,
  reconcileDailySchema,
  approveReconciliationSchema
  , payExpenseSchema
} from "./shifts.schemas.js";

export const shiftsRouter = Router();

shiftsRouter.use(authenticate);

// Attendance
shiftsRouter.post("/attendance/clock-in", requirePermission(PERMISSIONS.shiftOperate), validateRequest(clockInSchema), shiftsController.clockIn);
shiftsRouter.post("/attendance/clock-out", requirePermission(PERMISSIONS.shiftOperate), shiftsController.clockOut);
shiftsRouter.get("/attendance", requirePermission(PERMISSIONS.shiftManage), shiftsController.listAttendance);
shiftsRouter.get("/attendance/me", requirePermission(PERMISSIONS.shiftOperate), shiftsController.getMyAttendance);

// Shifts
shiftsRouter.get("/", requirePermission(PERMISSIONS.shiftManage), shiftsController.list);
shiftsRouter.get("/current", requirePermission(PERMISSIONS.shiftOperate), shiftsController.getCurrent);
shiftsRouter.post("/", requirePermission(PERMISSIONS.shiftOperate), validateRequest(startShiftSchema), shiftsController.startShift);
shiftsRouter.post("/:id/cash-movement", requirePermission(PERMISSIONS.shiftOperate), validateRequest(recordShiftCashSchema), shiftsController.recordCashMovement);
shiftsRouter.post("/:id/end", requirePermission(PERMISSIONS.shiftOperate), validateRequest(endShiftSchema), shiftsController.endShift);
shiftsRouter.post("/:id/review", requirePermission(PERMISSIONS.shiftManage), shiftsController.reviewShift);

// Expense categories
shiftsRouter.get("/expense-categories", shiftsController.listExpenseCategories);
shiftsRouter.post("/expense-categories", requirePermission(PERMISSIONS.organizationUpdate), validateRequest(createExpenseCategorySchema), shiftsController.createExpenseCategory);

// Expenses
shiftsRouter.get("/expenses", requirePermission(PERMISSIONS.expenseRequest), shiftsController.listExpenses);
shiftsRouter.get("/expenses/:id", requirePermission(PERMISSIONS.expenseRequest), shiftsController.getExpenseById);
shiftsRouter.post("/expenses", requirePermission(PERMISSIONS.expenseRequest), validateRequest(createExpenseSchema), shiftsController.createExpense);
shiftsRouter.post("/expenses/:id/approve", requirePermission(PERMISSIONS.expenseApprove), shiftsController.approveExpense);
shiftsRouter.post("/expenses/:id/reject", requirePermission(PERMISSIONS.expenseApprove), validateRequest(rejectExpenseSchema), shiftsController.rejectExpense);
shiftsRouter.post("/expenses/:id/pay", requirePermission(PERMISSIONS.expenseApprove), validateRequest(payExpenseSchema), shiftsController.payExpense);
shiftsRouter.post("/expenses/:id/reverse", requirePermission(PERMISSIONS.expenseReverse), shiftsController.reverseExpense);

// Daily Branch Reconciliation
shiftsRouter.get("/reconciliation", requirePermission(PERMISSIONS.reconciliationRead), shiftsController.listReconciliations);
shiftsRouter.get("/reconciliation/:id", requirePermission(PERMISSIONS.reconciliationRead), shiftsController.getReconciliationById);
shiftsRouter.post("/reconciliation", requirePermission(PERMISSIONS.reconciliationRead), validateRequest(reconcileDailySchema), shiftsController.reconcileBranch);
shiftsRouter.post("/reconciliation/:id/approve", requirePermission(PERMISSIONS.reconciliationApprove), validateRequest(approveReconciliationSchema), shiftsController.approveReconciliation);
shiftsRouter.post("/reconciliation/:id/return", requirePermission(PERMISSIONS.reconciliationApprove), validateRequest(approveReconciliationSchema), shiftsController.returnReconciliation);

// Keep the single-segment dynamic route after every named GET route.
shiftsRouter.get("/:id", requirePermission(PERMISSIONS.shiftManage), shiftsController.getById);
