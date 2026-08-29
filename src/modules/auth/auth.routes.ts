import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { authController } from "./auth.controller.js";
import {
  changePasswordSchema,
  deleteSessionSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema
} from "./auth.schemas.js";

export const authRouter = Router();

authRouter.post("/login", validateRequest(loginSchema), authController.login);
authRouter.post("/refresh", validateRequest(refreshSchema), authController.refresh);
authRouter.post("/forgot-password", validateRequest(forgotPasswordSchema), authController.forgotPassword);
authRouter.post("/reset-password", validateRequest(resetPasswordSchema), authController.resetPassword);

authRouter.use(authenticate);
authRouter.post("/logout", authController.logout);
authRouter.post("/logout-all", authController.logoutAll);
authRouter.post("/change-password", validateRequest(changePasswordSchema), authController.changePassword);
authRouter.get("/me", authController.me);
authRouter.get("/sessions", authController.sessions);
authRouter.delete("/sessions/:sessionId", validateRequest(deleteSessionSchema), authController.revokeSession);
