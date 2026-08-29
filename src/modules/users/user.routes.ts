import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { userController } from "./user.controller.js";
import {
  assignBranchesSchema,
  createUserSchema,
  resetUserPasswordSchema,
  updateUserSchema,
  userIdSchema
} from "./user.schemas.js";

export const userRouter = Router();

userRouter.use(authenticate);
userRouter.get("/", requirePermission(PERMISSIONS.userUpdate), userController.list);
userRouter.post("/", requirePermission(PERMISSIONS.userCreate), validateRequest(createUserSchema), userController.create);
userRouter.get("/me/profile", userController.meProfile);
userRouter.get("/:userId", requirePermission(PERMISSIONS.userUpdate), validateRequest(userIdSchema), userController.get);
userRouter.patch(
  "/:userId",
  requirePermission(PERMISSIONS.userUpdate),
  validateRequest(updateUserSchema),
  userController.update
);
userRouter.post(
  "/:userId/assign-branches",
  requirePermission(PERMISSIONS.userUpdate),
  validateRequest(assignBranchesSchema),
  userController.assignBranches
);
userRouter.post(
  "/:userId/reset-password",
  requirePermission(PERMISSIONS.userUpdate),
  validateRequest(resetUserPasswordSchema),
  userController.resetPassword
);
userRouter.post("/:userId/activate", requirePermission(PERMISSIONS.userUpdate), validateRequest(userIdSchema), userController.activate);
userRouter.post("/:userId/suspend", requirePermission(PERMISSIONS.userUpdate), validateRequest(userIdSchema), userController.suspend);
