import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { countsController } from "./counts.controller.js";
import { createStockCountSchema, updateStockCountItemsSchema, requestRecountSchema, postStockCountSchema } from "./counts.schemas.js";

export const countsRouter = Router();

countsRouter.use(authenticate);

countsRouter.get("/", requirePermission(PERMISSIONS.inventoryRead), countsController.list);
countsRouter.post("/", requirePermission(PERMISSIONS.stockCountCreate), validateRequest(createStockCountSchema), countsController.create);

countsRouter.get("/:id", requirePermission(PERMISSIONS.inventoryRead), countsController.get);
countsRouter.put("/:id/items", requirePermission(PERMISSIONS.stockCountSubmit), validateRequest(updateStockCountItemsSchema), countsController.updateItems);
countsRouter.patch("/:id/items", requirePermission(PERMISSIONS.stockCountSubmit), validateRequest(updateStockCountItemsSchema), countsController.updateItems);
countsRouter.post("/:id/start", requirePermission(PERMISSIONS.stockCountCreate), countsController.start);
countsRouter.post("/:id/submit", requirePermission(PERMISSIONS.stockCountSubmit), countsController.submit);
countsRouter.post("/:id/recount", requirePermission(PERMISSIONS.stockCountApprove), validateRequest(requestRecountSchema), countsController.requestRecount);
countsRouter.post("/:id/approve", requirePermission(PERMISSIONS.stockCountApprove), countsController.approve);
countsRouter.post("/:id/post", requirePermission(PERMISSIONS.stockCountPost), validateRequest(postStockCountSchema), countsController.post);
