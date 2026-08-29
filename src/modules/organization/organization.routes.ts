import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { organizationController } from "./organization.controller.js";
import { updateOrganizationSchema, updateOrganizationSettingsSchema } from "./organization.schemas.js";

export const organizationRouter = Router();

organizationRouter.use(authenticate);
organizationRouter.get("/", requirePermission(PERMISSIONS.organizationRead), organizationController.get);
organizationRouter.get("/settings", requirePermission(PERMISSIONS.organizationRead), organizationController.getSettings);
organizationRouter.patch("/settings", requirePermission(PERMISSIONS.organizationUpdate), validateRequest(updateOrganizationSettingsSchema), organizationController.updateSettings);
organizationRouter.patch(
  "/",
  requirePermission(PERMISSIONS.organizationUpdate),
  validateRequest(updateOrganizationSchema),
  organizationController.update
);
