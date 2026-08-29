import { Router } from "express";
import { customerAuthController } from "./customer-auth.controller.js";
import { authenticateCustomer } from "../../middleware/customer-auth.middleware.js";

export const customerAuthRouter = Router();

customerAuthRouter.post("/register", customerAuthController.register);
customerAuthRouter.post("/login", customerAuthController.login);
customerAuthRouter.post("/refresh", customerAuthController.refresh);
customerAuthRouter.post("/forgot-password", customerAuthController.forgotPassword);
customerAuthRouter.post("/reset-password", customerAuthController.resetPassword);

// Authenticated routes
customerAuthRouter.get("/me", authenticateCustomer, customerAuthController.me);
customerAuthRouter.post("/logout", authenticateCustomer, customerAuthController.logout);
customerAuthRouter.post("/logout-all", authenticateCustomer, customerAuthController.logoutAll);
