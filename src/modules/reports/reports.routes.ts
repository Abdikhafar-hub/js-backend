import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { reportsController } from "./reports.controller.js";

export const reportsRouter = Router();

reportsRouter.use(authenticate);

reportsRouter.use(requirePermission(PERMISSIONS.reportRead));
reportsRouter.get("/sales", requirePermission(PERMISSIONS.saleReadBranch), reportsController.salesReport);
reportsRouter.get("/gross-profit", requirePermission(PERMISSIONS.saleReadBranch), reportsController.grossProfitReport);
reportsRouter.get("/branches", requirePermission(PERMISSIONS.saleReadBranch), reportsController.branchReport);
reportsRouter.get("/products", requirePermission(PERMISSIONS.saleReadBranch), reportsController.productReport);
reportsRouter.get("/customers", requirePermission(PERMISSIONS.customerRead), reportsController.customerReport);
reportsRouter.get("/suppliers", requirePermission(PERMISSIONS.supplierRead), reportsController.supplierReport);
reportsRouter.get("/payments", requirePermission(PERMISSIONS.saleReadBranch), reportsController.paymentReport);
reportsRouter.get("/refunds", requirePermission(PERMISSIONS.saleReadBranch), reportsController.refundReport);
reportsRouter.get("/expenses", requirePermission(PERMISSIONS.expenseRequest), reportsController.expenseReport);
reportsRouter.get("/reconciliation", requirePermission(PERMISSIONS.reconciliationRead), reportsController.reconciliationReport);
reportsRouter.get("/inventory-valuation", requirePermission(PERMISSIONS.inventoryValuation), reportsController.inventoryValuation);
reportsRouter.get("/stock-alerts", requirePermission(PERMISSIONS.inventoryRead), reportsController.stockAlerts);
reportsRouter.get("/dashboard-cash-summary", requirePermission(PERMISSIONS.saleReadBranch), reportsController.dashboardCashSummary);
reportsRouter.get("/export/inventory-csv", requirePermission(PERMISSIONS.inventoryRead), reportsController.exportInventoryCSV);
