import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { shipmentsController } from "./shipments.controller.js";
import {
  createShipmentSchema,
  addShipmentCostSchema,
  updateShipmentStatusSchema
} from "./shipments.schemas.js";

export const shipmentsRouter = Router();

shipmentsRouter.use(authenticate);

shipmentsRouter.get("/", requirePermission(PERMISSIONS.procurementApprove), shipmentsController.list);
shipmentsRouter.post("/", requirePermission(PERMISSIONS.procurementApprove), validateRequest(createShipmentSchema), shipmentsController.create);

shipmentsRouter.get("/:id", requirePermission(PERMISSIONS.procurementApprove), shipmentsController.get);
shipmentsRouter.post("/:id/costs", requirePermission(PERMISSIONS.procurementApprove), validateRequest(addShipmentCostSchema), shipmentsController.addCost);
shipmentsRouter.patch("/:id/status", requirePermission(PERMISSIONS.procurementApprove), validateRequest(updateShipmentStatusSchema), shipmentsController.updateStatus);
