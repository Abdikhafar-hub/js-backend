import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { suppliersController } from "./suppliers.controller.js";
import {
  createSupplierSchema,
  updateSupplierSchema,
  addSupplierContactSchema,
  recordSupplierPaymentSchema
} from "./suppliers.schemas.js";

export const suppliersRouter = Router();

suppliersRouter.use(authenticate);

suppliersRouter.get("/lookup", requirePermission(PERMISSIONS.supplierLookup), suppliersController.lookup);
suppliersRouter.get("/", requirePermission(PERMISSIONS.supplierRead), suppliersController.list);
suppliersRouter.post("/", requirePermission(PERMISSIONS.supplierWrite), validateRequest(createSupplierSchema), suppliersController.create);

suppliersRouter.get("/:id", requirePermission(PERMISSIONS.supplierRead), suppliersController.get);
suppliersRouter.patch("/:id", requirePermission(PERMISSIONS.supplierWrite), validateRequest(updateSupplierSchema), suppliersController.update);

suppliersRouter.post("/:id/contacts", requirePermission(PERMISSIONS.supplierWrite), validateRequest(addSupplierContactSchema), suppliersController.addContact);
suppliersRouter.post("/:id/payments", requirePermission(PERMISSIONS.supplierWrite), validateRequest(recordSupplierPaymentSchema), suppliersController.recordPayment);
suppliersRouter.get("/:id/ledger", requirePermission(PERMISSIONS.supplierRead), suppliersController.getLedger);
