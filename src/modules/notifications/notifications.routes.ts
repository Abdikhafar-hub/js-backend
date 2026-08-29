import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware.js";
import { notificationsController } from "./notifications.controller.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);
notificationsRouter.use(requirePermission(PERMISSIONS.notificationRead));

notificationsRouter.get("/", notificationsController.list);
notificationsRouter.patch("/:id/read", notificationsController.markRead);
notificationsRouter.post("/mark-all-read", notificationsController.markAllRead);
