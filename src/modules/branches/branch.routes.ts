import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { branchController } from "./branch.controller.js";
import {
  assignBranchManagerSchema,
  branchIdSchema,
  createBranchSchema,
  updateBranchSchema
} from "./branch.schemas.js";

export const branchRouter = Router();

branchRouter.use(authenticate);
branchRouter.get(
  "/",
  requirePermission(PERMISSIONS.branchReadAssigned),
  branchController.list
);
branchRouter.post("/", requirePermission(PERMISSIONS.branchCreate), validateRequest(createBranchSchema), branchController.create);
branchRouter.post(
  "/:branchId/manager",
  requirePermission(PERMISSIONS.branchManagerAssign),
  validateRequest(assignBranchManagerSchema),
  branchController.assignManager
);
branchRouter.delete(
  "/:branchId/manager",
  requirePermission(PERMISSIONS.branchManagerAssign),
  validateRequest(branchIdSchema),
  branchController.removeManager
);
branchRouter.post(
  "/:branchId/manager/deactivate",
  requirePermission(PERMISSIONS.branchManagerAssign),
  validateRequest(branchIdSchema),
  branchController.deactivateManager
);
branchRouter.get(
  "/:branchId",
  requirePermission(PERMISSIONS.branchReadAssigned),
  validateRequest(branchIdSchema),
  branchController.get
);
branchRouter.patch(
  "/:branchId",
  requirePermission(PERMISSIONS.branchUpdate),
  validateRequest(updateBranchSchema),
  branchController.update
);
branchRouter.post(
  "/:branchId/activate",
  requirePermission(PERMISSIONS.branchUpdate),
  validateRequest(branchIdSchema),
  branchController.activate
);
branchRouter.post(
  "/:branchId/deactivate",
  requirePermission(PERMISSIONS.branchUpdate),
  validateRequest(branchIdSchema),
  branchController.deactivate
);
branchRouter.get("/:branchId/dashboard", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(branchIdSchema), branchController.dashboard);
