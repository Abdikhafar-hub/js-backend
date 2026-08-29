import { Router } from "express";
import { storefrontAccountController } from "./storefront-account.controller.js";
import { authenticateCustomer } from "../../middleware/customer-auth.middleware.js";

export const storefrontAccountRouter = Router();

// All self-service portal APIs require customer authentication
storefrontAccountRouter.use(authenticateCustomer);

// Profile
storefrontAccountRouter.get("/profile", storefrontAccountController.getProfile);
storefrontAccountRouter.patch("/profile", storefrontAccountController.updateProfile);

// Addresses
storefrontAccountRouter.get("/addresses", storefrontAccountController.listAddresses);
storefrontAccountRouter.post("/addresses", storefrontAccountController.createAddress);
storefrontAccountRouter.patch("/addresses/:id", storefrontAccountController.updateAddress);
storefrontAccountRouter.delete("/addresses/:id", storefrontAccountController.deleteAddress);
storefrontAccountRouter.post("/addresses/:id/default", storefrontAccountController.setDefaultAddress);

// Orders
storefrontAccountRouter.get("/orders", storefrontAccountController.listOrders);
storefrontAccountRouter.get("/orders/:orderNumber", storefrontAccountController.getOrderDetails);
storefrontAccountRouter.post("/orders/link", storefrontAccountController.linkGuestOrders);
storefrontAccountRouter.post("/orders/:orderNumber/reorder", storefrontAccountController.reorder);

// Loyalty
storefrontAccountRouter.get("/loyalty", storefrontAccountController.getLoyaltySummary);
storefrontAccountRouter.get("/loyalty/ledger", storefrontAccountController.getLoyaltyLedger);

// Security
storefrontAccountRouter.post("/security/change-password", storefrontAccountController.changePassword);
storefrontAccountRouter.get("/security/sessions", storefrontAccountController.listSessions);
storefrontAccountRouter.delete("/security/sessions/:sessionId", storefrontAccountController.revokeSession);
