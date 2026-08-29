import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { stockAdjustmentsController } from "./stock-adjustments.controller.js";
import {
  approveStockAdjustmentSchema,
  cancelStockAdjustmentSchema,
  createStockAdjustmentSchema,
  postStockAdjustmentSchema,
  rejectStockAdjustmentSchema,
  submitStockAdjustmentSchema
} from "./stock-adjustments.schemas.js";

export const stockAdjustmentsRouter = Router();

stockAdjustmentsRouter.use(authenticate);

stockAdjustmentsRouter.get("/", requirePermission(PERMISSIONS.inventoryRead), stockAdjustmentsController.list);
stockAdjustmentsRouter.post(
  "/",
  requirePermission(PERMISSIONS.adjustmentCreate),
  validateRequest(createStockAdjustmentSchema),
  stockAdjustmentsController.create
);
stockAdjustmentsRouter.get("/:id", requirePermission(PERMISSIONS.inventoryRead), stockAdjustmentsController.get);
stockAdjustmentsRouter.post(
  "/:id/submit",
  requirePermission(PERMISSIONS.adjustmentSubmit),
  validateRequest(submitStockAdjustmentSchema),
  stockAdjustmentsController.submit
);
stockAdjustmentsRouter.post(
  "/:id/approve",
  requirePermission(PERMISSIONS.adjustmentApprove),
  validateRequest(approveStockAdjustmentSchema),
  stockAdjustmentsController.approve
);
stockAdjustmentsRouter.post(
  "/:id/reject",
  requirePermission(PERMISSIONS.adjustmentReject),
  validateRequest(rejectStockAdjustmentSchema),
  stockAdjustmentsController.reject
);
stockAdjustmentsRouter.post(
  "/:id/post",
  requirePermission(PERMISSIONS.adjustmentPost),
  validateRequest(postStockAdjustmentSchema),
  stockAdjustmentsController.post
);
stockAdjustmentsRouter.post(
  "/:id/cancel",
  requirePermission(PERMISSIONS.adjustmentCancel),
  validateRequest(cancelStockAdjustmentSchema),
  stockAdjustmentsController.cancel
);
