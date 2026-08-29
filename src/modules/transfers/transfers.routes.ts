import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import {
  createTransferSchema,
  approveTransferSchema,
  receiveTransferSchema
} from "./transfers.schemas.js";

import { transfersController as controller } from "./transfers.controller.js";

export const transfersRouter = Router();

transfersRouter.use(authenticate);

transfersRouter.get("/options", requirePermission(PERMISSIONS.transferRequest), controller.listOptions);
transfersRouter.get("/", requirePermission(PERMISSIONS.transferRequest), controller.list);
transfersRouter.post("/", requirePermission(PERMISSIONS.transferRequest), validateRequest(createTransferSchema), controller.create);

transfersRouter.get("/:id", requirePermission(PERMISSIONS.transferRequest), controller.get);
transfersRouter.post("/:id/submit", requirePermission(PERMISSIONS.transferRequest), controller.submit);
transfersRouter.post("/:id/approve", requirePermission(PERMISSIONS.transferApprove), validateRequest(approveTransferSchema), controller.approve);
transfersRouter.post("/:id/pick", requirePermission(PERMISSIONS.transferReceive), controller.startPicking);
transfersRouter.post("/:id/dispatch", requirePermission(PERMISSIONS.transferReceive), controller.dispatch);
transfersRouter.post("/:id/receive", requirePermission(PERMISSIONS.transferReceive), validateRequest(receiveTransferSchema), controller.receive);
