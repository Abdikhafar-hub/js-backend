import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { reportsService } from "./reports.service.js";

export const reportsController = {
  salesReport: asyncHandler(async (request, response) => {
    const { startDate, endDate } = request.query;
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();
    const res = await reportsService.getSalesReport(request.auth!, start, end);
    sendSuccess(response, "Sales report generated", res);
  }),
  grossProfitReport: asyncHandler(async (request, response) => {
    const { startDate, endDate } = request.query;
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();
    const res = await reportsService.getGrossProfitReport(request.auth!, start, end);
    sendSuccess(response, "Gross profit report generated", res);
  }),
  branchReport: asyncHandler(async (request, response) => {
    const { startDate, endDate } = request.query;
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();
    const res = await reportsService.getBranchReport(request.auth!, start, end);
    sendSuccess(response, "Branch report generated", res);
  }),
  productReport: asyncHandler(async (request, response) => {
    const { startDate, endDate } = request.query;
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();
    const res = await reportsService.getProductReport(request.auth!, start, end);
    sendSuccess(response, "Product report generated", res);
  }),
  customerReport: asyncHandler(async (request, response) => {
    const res = await reportsService.getCustomerReport(request.auth!);
    sendSuccess(response, "Customer report generated", res);
  }),
  supplierReport: asyncHandler(async (request, response) => {
    const res = await reportsService.getSupplierReport(request.auth!);
    sendSuccess(response, "Supplier report generated", res);
  }),
  paymentReport: asyncHandler(async (request, response) => {
    const { startDate, endDate } = request.query;
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();
    const res = await reportsService.getPaymentReport(request.auth!, start, end);
    sendSuccess(response, "Payment report generated", res);
  }),
  refundReport: asyncHandler(async (request, response) => {
    const { startDate, endDate } = request.query;
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();
    const res = await reportsService.getRefundReport(request.auth!, start, end);
    sendSuccess(response, "Refund report generated", res);
  }),
  expenseReport: asyncHandler(async (request, response) => {
    const { startDate, endDate } = request.query;
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();
    const res = await reportsService.getExpenseReport(request.auth!, start, end);
    sendSuccess(response, "Expense report generated", res);
  }),
  reconciliationReport: asyncHandler(async (request, response) => {
    const { startDate, endDate } = request.query;
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();
    const res = await reportsService.getReconciliationReport(request.auth!, start, end);
    sendSuccess(response, "Reconciliation report generated", res);
  }),
  inventoryValuation: asyncHandler(async (request, response) => {
    const res = await reportsService.getInventoryValuation(request.auth!);
    sendSuccess(response, "Inventory valuation generated", res);
  }),
  stockAlerts: asyncHandler(async (request, response) => {
    const res = await reportsService.getStockAlerts(request.auth!);
    sendSuccess(response, "Stock alerts retrieved", res);
  }),
  dashboardCashSummary: asyncHandler(async (request, response) => {
    const { branchId, date } = request.query;
    const targetDate = date ? new Date(date as string) : new Date();
    const res = await reportsService.getDashboardCashSummary(
      request.auth!,
      branchId as string | undefined,
      targetDate
    );
    sendSuccess(response, "Dashboard cash summary generated", res);
  }),
  exportInventoryCSV: asyncHandler(async (request, response) => {
    const data = await reportsService.getStockAlerts(request.auth!);
    const csv = reportsService.convertToCSV(data);
    response.setHeader("Content-Type", "text/csv");
    response.setHeader("Content-Disposition", "attachment; filename=inventory-alerts.csv");
    response.send(csv);
  })
};
