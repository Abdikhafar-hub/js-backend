import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { customersController } from "./customers.controller.js";
import { createCustomerSchema, updateCustomerCreditSchema, updateCustomerSchema } from "./customers.schemas.js";

export const customersRouter = Router();

customersRouter.use(authenticate);

customersRouter.get(
  "/",
  requirePermission(PERMISSIONS.customerRead),
  customersController.listCustomers
);

customersRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.customerRead),
  customersController.getCustomer
);

customersRouter.post(
  "/",
  requirePermission(PERMISSIONS.customerWrite),
  validateRequest(createCustomerSchema),
  customersController.createCustomer
);

customersRouter.put(
  "/:id",
  requirePermission(PERMISSIONS.customerWrite),
  validateRequest(updateCustomerSchema),
  customersController.updateCustomer
);

customersRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.customerWrite),
  validateRequest(updateCustomerSchema),
  customersController.updateCustomer
);

customersRouter.patch(
  "/:id/credit",
  requirePermission(PERMISSIONS.customerCreditManage),
  validateRequest(updateCustomerCreditSchema),
  customersController.updateCredit
);

customersRouter.get(
  "/:id/ledger",
  requirePermission(PERMISSIONS.customerCreditManage),
  customersController.getCustomerLedger
);

customersRouter.get(
  "/:id/sales",
  requirePermission(PERMISSIONS.customerRead),
  customersController.getCustomerSales
);

customersRouter.get(
  "/:id/invoices",
  requirePermission(PERMISSIONS.customerFinancialRead),
  customersController.getCustomerInvoices
);

customersRouter.get(
  "/:id/quotations",
  requirePermission(PERMISSIONS.customerFinancialRead),
  customersController.getCustomerQuotations
);
