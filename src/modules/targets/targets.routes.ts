import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { targetsController } from "./targets.controller.js";
import { createSalesTargetSchema } from "./targets.schemas.js";

export const targetsRouter = Router();

targetsRouter.use(authenticate);

targetsRouter.get("/", requirePermission(PERMISSIONS.saleReadBranch), targetsController.list);
targetsRouter.post("/", requirePermission(PERMISSIONS.branchUpdate), validateRequest(createSalesTargetSchema), targetsController.create);
targetsRouter.get("/performance/me", requirePermission(PERMISSIONS.saleReadOwn), targetsController.getMyPerformance);
targetsRouter.get("/performance/attendants", requirePermission(PERMISSIONS.saleReadBranch), targetsController.getAttendantPerformance);
targetsRouter.get("/:id/performance", requirePermission(PERMISSIONS.saleReadBranch), targetsController.getPerformance);
