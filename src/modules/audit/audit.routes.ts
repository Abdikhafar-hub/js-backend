import { Router } from "express";
import { z } from "zod";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { auditController } from "./audit.controller.js";

const idParamSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  })
});

export const auditRouter = Router();

auditRouter.use(authenticate);
auditRouter.use(requirePermission(PERMISSIONS.auditRead));
auditRouter.get("/", auditController.list);
auditRouter.get("/:id", validateRequest(idParamSchema), auditController.get);
