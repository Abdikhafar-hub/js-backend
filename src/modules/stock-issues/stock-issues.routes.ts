import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { stockIssuesController } from "./stock-issues.controller.js";
import {
  convertStockIssueToAdjustmentSchema,
  createStockIssueSchema,
  rejectStockIssueSchema,
  reviewStockIssueSchema
} from "./stock-issues.schemas.js";

export const stockIssuesRouter = Router();

stockIssuesRouter.use(authenticate);

stockIssuesRouter.get("/", requirePermission(PERMISSIONS.stockIssueReport), stockIssuesController.list);
stockIssuesRouter.post(
  "/",
  requirePermission(PERMISSIONS.stockIssueReport),
  validateRequest(createStockIssueSchema),
  stockIssuesController.create
);
stockIssuesRouter.get("/:id", requirePermission(PERMISSIONS.stockIssueReport), stockIssuesController.get);
stockIssuesRouter.post(
  "/:id/review",
  requirePermission(PERMISSIONS.stockIssueReview),
  validateRequest(reviewStockIssueSchema),
  stockIssuesController.review
);
stockIssuesRouter.post(
  "/:id/reject",
  requirePermission(PERMISSIONS.stockIssueReview),
  validateRequest(rejectStockIssueSchema),
  stockIssuesController.reject
);
stockIssuesRouter.post(
  "/:id/convert-to-adjustment",
  requirePermission(PERMISSIONS.inventoryAdjust),
  validateRequest(convertStockIssueToAdjustmentSchema),
  stockIssuesController.convertToAdjustment
);
