import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { paymentsController } from "./payments.controller.js";
import {
  recordPaymentSchema,
  createCreditDebitNoteSchema,
  processReturnSchema,
  initiateStkPushSchema,
  reversePaymentSchema,
  saveMpesaConfigSchema,
  resolveReconciliationSchema,
  reviewReturnSchema,
  inspectReturnSchema,
  rejectReturnSchema,
  approveRefundSchema,
  processRefundSchema,
  createExchangeSchema,
  createRefundRequestSchema,
  updateRefundRequestSchema,
  submitRefundSchema,
  returnRefundForCorrectionSchema,
  cancelRefundSchema
} from "./payments.schemas.js";

export const paymentsRouter = Router();

// M-Pesa webhook callback: public endpoint accessed by Safaricom servers
paymentsRouter.post("/mpesa/callback", paymentsController.mpesaCallback);

// Authenticated routes
paymentsRouter.use(authenticate);

paymentsRouter.post("/invoice-payments", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(recordPaymentSchema), paymentsController.recordPayment);
paymentsRouter.get("/invoice-payments", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.listPayments);
paymentsRouter.get("/invoice-payments/:id", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.getPaymentDetail);
paymentsRouter.post("/invoice-payments/:id/reverse", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(reversePaymentSchema), paymentsController.reversePayment);

paymentsRouter.post("/credit-debit-notes", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(createCreditDebitNoteSchema), paymentsController.createCreditDebitNote);
paymentsRouter.post("/returns", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(processReturnSchema), paymentsController.processReturn);
paymentsRouter.get("/returns", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.listReturns);
paymentsRouter.get("/returns/:id", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.getReturnDetail);
paymentsRouter.post("/returns/:id/review", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(reviewReturnSchema), paymentsController.reviewReturn);
paymentsRouter.post("/returns/:id/inspect", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(inspectReturnSchema), paymentsController.inspectReturn);
paymentsRouter.post("/returns/:id/approve", requirePermission(PERMISSIONS.saleReadBranch), paymentsController.approveReturn);
paymentsRouter.post("/returns/:id/reject", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(rejectReturnSchema), paymentsController.rejectReturn);
paymentsRouter.post("/returns/:id/complete", requirePermission(PERMISSIONS.saleReadBranch), paymentsController.completeReturn);

paymentsRouter.get("/refunds/summary", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.refundSummary);
paymentsRouter.get("/refunds/lookup", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.lookupRefundSales);
paymentsRouter.get("/refunds", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.listRefunds);
paymentsRouter.post("/refunds", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(createRefundRequestSchema), paymentsController.createRefundRequest);
paymentsRouter.get("/refunds/:id", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.getRefund);
paymentsRouter.put("/refunds/:id", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(updateRefundRequestSchema), paymentsController.updateRefundRequest);
paymentsRouter.post("/refunds/:id/submit", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(submitRefundSchema), paymentsController.submitRefundRequest);
paymentsRouter.post("/refunds/:id/approve", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(approveRefundSchema), paymentsController.approveRefund);
paymentsRouter.post("/refunds/:id/reject", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(rejectReturnSchema), paymentsController.rejectRefund);
paymentsRouter.post("/refunds/:id/return-for-correction", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(returnRefundForCorrectionSchema), paymentsController.returnRefundForCorrection);
paymentsRouter.post("/refunds/:id/cancel", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(cancelRefundSchema), paymentsController.cancelRefund);
paymentsRouter.post("/refunds/:id/process", requirePermission(PERMISSIONS.saleReadBranch), validateRequest(processRefundSchema), paymentsController.processRefund);

paymentsRouter.get("/exchanges", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.listExchanges);
paymentsRouter.post("/exchanges", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(createExchangeSchema), paymentsController.createExchange);
paymentsRouter.get("/exchanges/:id", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.getExchange);

paymentsRouter.post("/mpesa/stk-push", requirePermission(PERMISSIONS.saleReadOwn), validateRequest(initiateStkPushSchema), paymentsController.initiateStkPush);
paymentsRouter.get("/mpesa/transactions", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.listMpesaTransactions);
paymentsRouter.get("/mpesa/transactions/:id", requirePermission(PERMISSIONS.saleReadOwn), paymentsController.getMpesaTransactionDetail);
paymentsRouter.get("/mpesa/config", requirePermission(PERMISSIONS.mpesaConfigManage), paymentsController.getMpesaConfig);
paymentsRouter.post("/mpesa/config", requirePermission(PERMISSIONS.mpesaConfigManage), validateRequest(saveMpesaConfigSchema), paymentsController.saveMpesaConfig);

paymentsRouter.get("/reconciliations", requirePermission(PERMISSIONS.mpesaConfigManage), paymentsController.listReconciliations);
paymentsRouter.post("/reconciliations/resolve", requirePermission(PERMISSIONS.mpesaConfigManage), validateRequest(resolveReconciliationSchema), paymentsController.resolveReconciliation);
