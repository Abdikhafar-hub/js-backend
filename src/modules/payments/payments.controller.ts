import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { shapeOperationalResponse } from "../../lib/response-scope.js";
import { paymentsService } from "./payments.service.js";

export const paymentsController = {
  recordPayment: asyncHandler(async (request, response) => {
    const res = await paymentsService.recordPayment(request.auth!, request.body, request);
    sendSuccess(response, "Payment recorded successfully", res);
  }),

  createCreditDebitNote: asyncHandler(async (request, response) => {
    const res = await paymentsService.createCreditDebitNote(request.auth!, request.body, request);
    sendSuccess(response, "Debit/Credit Note created successfully", res);
  }),

  processReturn: asyncHandler(async (request, response) => {
    const res = await paymentsService.createReturnRequest(request.auth!, request.body, request);
    sendSuccess(response, "Return request submitted successfully", shapeOperationalResponse(request.auth!, res));
  }),

  initiateStkPush: asyncHandler(async (request, response) => {
    const res = await paymentsService.initiateStkPush(request.auth!, request.body);
    sendSuccess(response, "STK Push initiated successfully", res);
  }),

  mpesaCallback: asyncHandler(async (request, response) => {
    const res = await paymentsService.handleMpesaCallback(request.body, request);
    sendSuccess(response, "Callback processed", res);
  }),

  listPayments: asyncHandler(async (request, response) => {
    const res = await paymentsService.listPayments(request.auth!, request.query);
    sendSuccess(response, "Payments fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  getPaymentDetail: asyncHandler(async (request, response) => {
    const res = await paymentsService.getPaymentDetail(request.auth!, request.params.id!);
    sendSuccess(response, "Payment details fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  reversePayment: asyncHandler(async (request, response) => {
    const res = await paymentsService.reversePayment(request.auth!, request.params.id!, request.body.reason, request);
    sendSuccess(response, "Payment reversed successfully", res);
  }),

  listMpesaTransactions: asyncHandler(async (request, response) => {
    const res = await paymentsService.listMpesaTransactions(request.auth!, request.query);
    sendSuccess(response, "M-Pesa transactions fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  getMpesaTransactionDetail: asyncHandler(async (request, response) => {
    const res = await paymentsService.getMpesaTransactionDetail(request.auth!, request.params.id!);
    sendSuccess(response, "M-Pesa transaction details fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  getMpesaConfig: asyncHandler(async (request, response) => {
    const res = await paymentsService.getMpesaConfig(request.auth!);
    sendSuccess(response, "M-Pesa configuration fetched successfully", res);
  }),

  saveMpesaConfig: asyncHandler(async (request, response) => {
    const res = await paymentsService.saveMpesaConfig(request.auth!, request.body);
    sendSuccess(response, "M-Pesa configuration saved successfully", res);
  }),

  listReconciliations: asyncHandler(async (request, response) => {
    const res = await paymentsService.listReconciliations(request.auth!, request.query);
    sendSuccess(response, "M-Pesa reconciliation records fetched successfully", res);
  }),

  resolveReconciliation: asyncHandler(async (request, response) => {
    const res = await paymentsService.resolveReconciliation(request.auth!, request.body, request);
    sendSuccess(response, "M-Pesa reconciliation resolved successfully", res);
  }),

  listReturns: asyncHandler(async (request, response) => {
    const res = await paymentsService.listReturns(request.auth!, request.query);
    sendSuccess(response, "Returns fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  getReturnDetail: asyncHandler(async (request, response) => {
    const res = await paymentsService.getReturnDetail(request.auth!, request.params.id!);
    sendSuccess(response, "Return details fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  reviewReturn: asyncHandler(async (request, response) => {
    const res = await paymentsService.reviewReturn(request.auth!, request.params.id!, request.body.notes, request);
    sendSuccess(response, "Return moved to review", res);
  }),

  inspectReturn: asyncHandler(async (request, response) => {
    const res = await paymentsService.inspectReturn(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Return inspection recorded", shapeOperationalResponse(request.auth!, res));
  }),

  approveReturn: asyncHandler(async (request, response) => {
    const res = await paymentsService.approveReturn(request.auth!, request.params.id!, request);
    sendSuccess(response, "Return approved", res);
  }),

  rejectReturn: asyncHandler(async (request, response) => {
    const res = await paymentsService.rejectReturn(request.auth!, request.params.id!, request.body.reason, request);
    sendSuccess(response, "Return rejected", res);
  }),

  completeReturn: asyncHandler(async (request, response) => {
    const res = await paymentsService.completeReturn(request.auth!, request.params.id!, request);
    sendSuccess(response, "Return inventory disposition completed", shapeOperationalResponse(request.auth!, res));
  }),

  refundSummary: asyncHandler(async (request, response) => {
    const res = await paymentsService.refundSummary(request.auth!, request.query);
    sendSuccess(response, "Refund summary fetched successfully", res);
  }),

  lookupRefundSales: asyncHandler(async (request, response) => {
    const res = await paymentsService.lookupRefundSales(request.auth!, request.query);
    sendSuccess(response, "Refund candidates fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  listRefunds: asyncHandler(async (request, response) => {
    const res = await paymentsService.listRefunds(request.auth!, request.query);
    sendSuccess(response, "Refunds fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  createRefundRequest: asyncHandler(async (request, response) => {
    const res = await paymentsService.createRefundRequest(request.auth!, request.body, request);
    sendSuccess(response, "Refund draft created successfully", shapeOperationalResponse(request.auth!, res));
  }),

  getRefund: asyncHandler(async (request, response) => {
    const res = await paymentsService.getRefund(request.auth!, request.params.id!);
    sendSuccess(response, "Refund fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  updateRefundRequest: asyncHandler(async (request, response) => {
    const res = await paymentsService.updateRefundRequest(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Refund draft updated successfully", shapeOperationalResponse(request.auth!, res));
  }),

  submitRefundRequest: asyncHandler(async (request, response) => {
    const res = await paymentsService.submitRefundRequest(request.auth!, request.params.id!, request);
    sendSuccess(response, "Refund submitted for approval", shapeOperationalResponse(request.auth!, res));
  }),

  approveRefund: asyncHandler(async (request, response) => {
    const res = await paymentsService.approveRefund(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Refund approved", res);
  }),

  rejectRefund: asyncHandler(async (request, response) => {
    const res = await paymentsService.rejectRefund(request.auth!, request.params.id!, request.body.reason, request);
    sendSuccess(response, "Refund rejected", res);
  }),

  returnRefundForCorrection: asyncHandler(async (request, response) => {
    const res = await paymentsService.returnRefundForCorrection(request.auth!, request.params.id!, request.body.instructions, request);
    sendSuccess(response, "Refund returned for correction", res);
  }),

  cancelRefund: asyncHandler(async (request, response) => {
    const res = await paymentsService.cancelRefund(request.auth!, request.params.id!, request.body.reason, request);
    sendSuccess(response, "Refund cancelled", res);
  }),

  processRefund: asyncHandler(async (request, response) => {
    const res = await paymentsService.processRefund(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Refund processing updated", res);
  }),

  listExchanges: asyncHandler(async (request, response) => {
    const res = await paymentsService.listExchanges(request.auth!, request.query);
    sendSuccess(response, "Exchanges fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  getExchange: asyncHandler(async (request, response) => {
    const res = await paymentsService.getExchange(request.auth!, request.params.id!);
    sendSuccess(response, "Exchange fetched successfully", shapeOperationalResponse(request.auth!, res));
  }),

  createExchange: asyncHandler(async (request, response) => {
    const res = await paymentsService.createExchange(request.auth!, request.body, request);
    sendSuccess(response, "Exchange completed successfully", shapeOperationalResponse(request.auth!, res));
  })
};
