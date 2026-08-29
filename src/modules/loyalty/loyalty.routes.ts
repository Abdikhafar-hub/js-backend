import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { loyaltyController } from "./loyalty.controller.js";
import {
  redeemLoyaltyPointsSchema,
  adjustLoyaltyPointsSchema,
  saveLoyaltyProgramSchema
} from "./loyalty.schemas.js";

export const loyaltyRouter = Router();

loyaltyRouter.use(authenticate);

loyaltyRouter.get("/history/:customerId", requirePermission(PERMISSIONS.saleReadOwn), loyaltyController.getHistory);
loyaltyRouter.post("/redeem", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(redeemLoyaltyPointsSchema), loyaltyController.redeem);
loyaltyRouter.get("/programs", requirePermission(PERMISSIONS.saleReadOwn), loyaltyController.listPrograms);
loyaltyRouter.post("/programs", requirePermission(PERMISSIONS.organizationUpdate), validateRequest(saveLoyaltyProgramSchema), loyaltyController.saveProgram);
loyaltyRouter.post("/adjustments", requirePermission(PERMISSIONS.organizationUpdate), validateRequest(adjustLoyaltyPointsSchema), loyaltyController.adjustPoints);
