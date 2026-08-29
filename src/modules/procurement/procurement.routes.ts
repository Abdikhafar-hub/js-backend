import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { procurementController } from "./procurement.controller.js";
import {
  createRequisitionSchema,
  updateRequisitionSchema,
  approveRequisitionSchema,
  rejectRequisitionSchema,
  createPOSchema,
  convertRequisitionToPOSchema,
  approvePOSchema
} from "./procurement.schemas.js";

export const procurementRouter = Router();

procurementRouter.use(authenticate);

// Requisitions
procurementRouter.get("/requisitions", requirePermission(PERMISSIONS.procurementRequest), procurementController.listRequisitions);
procurementRouter.post("/requisitions", requirePermission(PERMISSIONS.procurementRequest), validateRequest(createRequisitionSchema), procurementController.createRequisition);
procurementRouter.get("/requisitions/:id", requirePermission(PERMISSIONS.procurementRequest), procurementController.getRequisition);
procurementRouter.post("/requisitions/:id/submit", requirePermission(PERMISSIONS.procurementRequest), procurementController.submitRequisition);
procurementRouter.post("/requisitions/:id/approve", requirePermission(PERMISSIONS.procurementApprove), validateRequest(approveRequisitionSchema), procurementController.approveRequisition);
procurementRouter.post("/requisitions/:id/reject", requirePermission(PERMISSIONS.procurementApprove), validateRequest(rejectRequisitionSchema), procurementController.rejectRequisition);
procurementRouter.post(
  "/requisitions/:id/convert-to-purchase-order",
  requirePermission(PERMISSIONS.procurementApprove),
  validateRequest(convertRequisitionToPOSchema),
  procurementController.convertRequisitionToPO
);

// POs
procurementRouter.get("/purchase-orders", requirePermission(PERMISSIONS.procurementRequest), procurementController.listPOs);
procurementRouter.post("/purchase-orders", requirePermission(PERMISSIONS.procurementApprove), validateRequest(createPOSchema), procurementController.createPO);
procurementRouter.get("/purchase-orders/:id", requirePermission(PERMISSIONS.procurementRequest), procurementController.getPO);
procurementRouter.post("/purchase-orders/:id/submit", requirePermission(PERMISSIONS.procurementApprove), procurementController.submitPO);
procurementRouter.post("/purchase-orders/:id/approve", requirePermission(PERMISSIONS.procurementApprove), validateRequest(approvePOSchema), procurementController.approvePO);
procurementRouter.post("/purchase-orders/:id/send", requirePermission(PERMISSIONS.procurementApprove), procurementController.sendToSupplier);
procurementRouter.post("/purchase-orders/:id/cancel", requirePermission(PERMISSIONS.procurementApprove), procurementController.cancelPO);
