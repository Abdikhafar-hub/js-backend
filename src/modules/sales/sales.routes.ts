import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { salesController } from "./sales.controller.js";
import { createQuotationSchema, checkoutSchema, quotePriceSchema, suspendSchema, cancelSaleSchema, payInvoiceSchema, createDiscountRequestSchema, rejectDiscountRequestSchema, createInvoiceSchema } from "./sales.schemas.js";

export const salesRouter = Router();

salesRouter.use(authenticate);

// Sales History & Lookup
salesRouter.get("/workspace/summary", requirePermission(PERMISSIONS.saleReadOwn), salesController.workspaceSummary);
salesRouter.get("/", requirePermission(PERMISSIONS.saleReadOwn), salesController.listSales);
salesRouter.get("/suspended", requirePermission(PERMISSIONS.saleReadOwn), salesController.listSuspendedSales);
salesRouter.post("/:id/cancel", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(cancelSaleSchema), salesController.cancelSale);

// POS Operations
salesRouter.post("/checkout", requirePermission(PERMISSIONS.posOperate), validateRequest(checkoutSchema), salesController.checkout);
salesRouter.post("/quote-price", requirePermission(PERMISSIONS.posOperate), validateRequest(quotePriceSchema), salesController.quotePrice);
salesRouter.post("/suspend", requirePermission(PERMISSIONS.posOperate), validateRequest(suspendSchema), salesController.suspendSale);
salesRouter.delete("/suspended/:id", requirePermission(PERMISSIONS.posOperate), salesController.deleteSuspendedSale);

salesRouter.get("/discount-requests", requirePermission(PERMISSIONS.saleReadOwn), salesController.listDiscountRequests);
salesRouter.post("/discount-requests", requirePermission(PERMISSIONS.posOperate), validateRequest(createDiscountRequestSchema), salesController.createDiscountRequest);
salesRouter.post("/discount-requests/:id/approve", requirePermission(PERMISSIONS.saleReadBranch), salesController.approveDiscountRequest);
salesRouter.post("/discount-requests/:id/reject", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(rejectDiscountRequestSchema), salesController.rejectDiscountRequest);

// Wholesale Quotations
salesRouter.get("/quotations", requirePermission(PERMISSIONS.saleReadBranch), salesController.listQuotations);
salesRouter.post("/quotations", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(createQuotationSchema), salesController.createQuotation);
salesRouter.get("/quotations/:id", requirePermission(PERMISSIONS.saleReadBranch), salesController.getQuotation);
salesRouter.post("/quotations/:id/accept", requirePermission(PERMISSIONS.saleReadBranch), salesController.acceptQuotation);
salesRouter.post("/quotations/:id/reject", requirePermission(PERMISSIONS.saleReadBranch), salesController.rejectQuotation);
salesRouter.post("/quotations/:id/convert", requirePermission(PERMISSIONS.saleReadBranch), salesController.convertQuotation);

// Wholesale Orders (represented by Sale with saleType = "WHOLESALE")
salesRouter.post("/orders/:id/approve", requirePermission(PERMISSIONS.saleReadBranch), salesController.approveOrder);
salesRouter.post("/orders/:id/fulfil", requirePermission(PERMISSIONS.saleReadBranch), salesController.fulfilOrder);
salesRouter.post("/orders/:id/invoice", requirePermission(PERMISSIONS.saleReadBranch), salesController.invoiceOrder);
salesRouter.post("/orders/:id/cancel", requirePermission(PERMISSIONS.saleReadBranch), salesController.cancelOrder);

// Invoices
salesRouter.get("/invoices/summary", requirePermission(PERMISSIONS.saleReadOwn), salesController.invoiceWorkspaceSummary);
salesRouter.get("/invoices", requirePermission(PERMISSIONS.saleReadOwn), salesController.listInvoices);
salesRouter.post("/invoices", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(createInvoiceSchema), salesController.createManualInvoice);
salesRouter.get("/invoices/:id", requirePermission(PERMISSIONS.saleReadOwn), salesController.getInvoice);
salesRouter.post("/invoices/:id/pay", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(payInvoiceSchema), salesController.payInvoice);
salesRouter.post("/:id/invoice", requirePermission(PERMISSIONS.saleReadBranch), salesController.generateInvoice);

// Keep the single-segment dynamic route after /quotations and /invoices.
salesRouter.get("/:id", requirePermission(PERMISSIONS.saleReadOwn), salesController.getSale);
