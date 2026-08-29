import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { shiftsService } from "./shifts.service.js";

export const shiftsController = {
  // Shift listing
  list: asyncHandler(async (request, response) => {
    const res = await shiftsService.listShifts(request.auth!, request.query);
    sendSuccess(response, "Shifts retrieved", res);
  }),
  getCurrent: asyncHandler(async (request, response) => {
    const res = await shiftsService.getCurrentShift(request.auth!);
    sendSuccess(response, "Current shift retrieved", res);
  }),
  getById: asyncHandler(async (request, response) => {
    const res = await shiftsService.getShiftById(request.auth!, request.params.id!);
    sendSuccess(response, "Shift retrieved", res);
  }),

  // Attendance
  clockIn: asyncHandler(async (request, response) => {
    const res = await shiftsService.clockIn(request.auth!, request.body, request);
    sendSuccess(response, "Clocked in successfully", res);
  }),
  clockOut: asyncHandler(async (request, response) => {
    const res = await shiftsService.clockOut(request.auth!, request);
    sendSuccess(response, "Clocked out successfully", res);
  }),
  listAttendance: asyncHandler(async (request, response) => {
    const res = await shiftsService.listAttendance(request.auth!, request.query);
    sendSuccess(response, "Attendance records retrieved", res);
  }),
  getMyAttendance: asyncHandler(async (request, response) => {
    const res = await shiftsService.getMyAttendance(request.auth!);
    sendSuccess(response, "My attendance retrieved", res);
  }),

  // Shifts
  startShift: asyncHandler(async (request, response) => {
    const res = await shiftsService.startShift(request.auth!, request.body, request);
    sendSuccess(response, "Shift opened successfully", res);
  }),
  recordCashMovement: asyncHandler(async (request, response) => {
    const res = await shiftsService.recordCashMovement(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Cash movement logged successfully", res);
  }),
  endShift: asyncHandler(async (request, response) => {
    const res = await shiftsService.endShift(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Shift close request recorded", res);
  }),
  reviewShift: asyncHandler(async (request, response) => {
    const res = await shiftsService.reviewShift(request.auth!, request.params.id!, request);
    sendSuccess(response, "Shift close reviewed", res);
  }),

  // Expense categories
  listExpenseCategories: asyncHandler(async (request, response) => {
    const res = await shiftsService.listExpenseCategories(request.auth!);
    sendSuccess(response, "Expense categories retrieved", res);
  }),
  createExpenseCategory: asyncHandler(async (request, response) => {
    const res = await shiftsService.createExpenseCategory(request.auth!, request.body, request);
    sendSuccess(response, "Expense category created", res);
  }),

  // Expenses
  listExpenses: asyncHandler(async (request, response) => {
    const res = await shiftsService.listExpenses(request.auth!, request.query);
    sendSuccess(response, "Expenses retrieved", res);
  }),
  getExpenseById: asyncHandler(async (request, response) => {
    const res = await shiftsService.getExpenseById(request.auth!, request.params.id!);
    sendSuccess(response, "Expense retrieved", res);
  }),
  createExpense: asyncHandler(async (request, response) => {
    const res = await shiftsService.createExpense(request.auth!, request.body, request);
    sendSuccess(response, "Expense created successfully", res);
  }),
  approveExpense: asyncHandler(async (request, response) => {
    const res = await shiftsService.approveExpense(request.auth!, request.params.id!, request);
    sendSuccess(response, "Expense approved successfully", res);
  }),
  rejectExpense: asyncHandler(async (request, response) => {
    const res = await shiftsService.rejectExpense(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Expense rejected", res);
  }),
  payExpense: asyncHandler(async (request, response) => {
    const res = await shiftsService.payExpense(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Expense paid", res);
  }),
  reverseExpense: asyncHandler(async (request, response) => {
    const res = await shiftsService.reverseExpense(request.auth!, request.params.id!, request);
    sendSuccess(response, "Expense reversed", res);
  }),

  // Reconciliation
  listReconciliations: asyncHandler(async (request, response) => {
    const res = await shiftsService.listReconciliations(request.auth!, request.query);
    sendSuccess(response, "Reconciliations retrieved", res);
  }),
  getReconciliationById: asyncHandler(async (request, response) => {
    const res = await shiftsService.getReconciliationById(request.auth!, request.params.id!);
    sendSuccess(response, "Reconciliation retrieved", res);
  }),
  reconcileBranch: asyncHandler(async (request, response) => {
    const res = await shiftsService.reconcileDailyBranch(request.auth!, request.body, request);
    sendSuccess(response, "Branch reconciliation completed successfully", res);
  }),
  approveReconciliation: asyncHandler(async (request, response) => {
    const res = await shiftsService.approveReconciliation(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Reconciliation approved", res);
  }),
  returnReconciliation: asyncHandler(async (request, response) => {
    const res = await shiftsService.returnReconciliation(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Reconciliation returned for correction", res);
  })
};
