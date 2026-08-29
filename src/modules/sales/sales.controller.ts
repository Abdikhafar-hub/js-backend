import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { salesService } from "./sales.service.js";
import { shapeOperationalResponse } from "../../lib/response-scope.js";

export const salesController = {
  workspaceSummary: asyncHandler(async (request, response) => {
    const summary = await salesService.workspaceSummary(request.auth!, request.query);
    sendSuccess(response, "Sales workspace summary fetched successfully", summary);
  }),

  // Quotations
  listQuotations: asyncHandler(async (request, response) => {
    const list = await salesService.listQuotations(request.auth!, request.query);
    sendSuccess(response, "Quotations fetched successfully", shapeOperationalResponse(request.auth!, list));
  }),

  getQuotation: asyncHandler(async (request, response) => {
    const quote = await salesService.getQuotation(request.auth!, request.params.id!);
    sendSuccess(response, "Quotation fetched successfully", shapeOperationalResponse(request.auth!, quote));
  }),

  createQuotation: asyncHandler(async (request, response) => {
    const quote = await salesService.createQuotation(request.auth!, request.body, request);
    sendSuccess(response, "Quotation created successfully", quote);
  }),

  // Invoices
  invoiceWorkspaceSummary: asyncHandler(async (request, response) => {
    const summary = await salesService.invoiceWorkspaceSummary(request.auth!, request.query);
    sendSuccess(response, "Invoice workspace summary fetched successfully", shapeOperationalResponse(request.auth!, summary));
  }),

  listInvoices: asyncHandler(async (request, response) => {
    const list = await salesService.listInvoices(request.auth!, request.query);
    sendSuccess(response, "Invoices fetched successfully", shapeOperationalResponse(request.auth!, list));
  }),

  createManualInvoice: asyncHandler(async (request, response) => {
    const invoice = await salesService.createManualInvoice(request.auth!, request.body, request);
    sendSuccess(response, "Invoice created successfully", shapeOperationalResponse(request.auth!, invoice));
  }),

  getInvoice: asyncHandler(async (request, response) => {
    const invoice = await salesService.getInvoice(request.auth!, request.params.id!);
    sendSuccess(response, "Invoice fetched successfully", shapeOperationalResponse(request.auth!, invoice));
  }),

  checkout: asyncHandler(async (request, response) => {
    const sale = await salesService.checkout(request.auth!, request.body, request);
    sendSuccess(response, "Checkout completed successfully", shapeOperationalResponse(request.auth!, sale));
  }),

  quotePrice: asyncHandler(async (request, response) => {
    const quote = await salesService.quotePrice(request.auth!, request.body);
    sendSuccess(response, "Price quote calculated successfully", quote);
  }),

  listSales: asyncHandler(async (request, response) => {
    const list = await salesService.listSales(request.auth!, request.query);
    sendSuccess(response, "Sales fetched successfully", shapeOperationalResponse(request.auth!, list));
  }),

  getSale: asyncHandler(async (request, response) => {
    const sale = await salesService.getSale(request.auth!, request.params.id!);
    sendSuccess(response, "Sale fetched successfully", shapeOperationalResponse(request.auth!, sale));
  }),

  suspendSale: asyncHandler(async (request, response) => {
    const sale = await salesService.suspendSale(request.auth!, request.body, request);
    sendSuccess(response, "Sale suspended successfully", shapeOperationalResponse(request.auth!, sale));
  }),

  listSuspendedSales: asyncHandler(async (request, response) => {
    const list = await salesService.listSuspendedSales(request.auth!, request.query);
    sendSuccess(response, "Suspended sales fetched successfully", shapeOperationalResponse(request.auth!, list));
  }),

  deleteSuspendedSale: asyncHandler(async (request, response) => {
    const sale = await salesService.deleteSuspendedSale(request.auth!, request.params.id!, request);
    sendSuccess(response, "Suspended sale discarded successfully", sale);
  }),

  cancelSale: asyncHandler(async (request, response) => {
    const sale = await salesService.cancelSale(request.auth!, request.params.id!, request.body.reason, request);
    sendSuccess(response, "Sale voided successfully", sale);
  }),

  acceptQuotation: asyncHandler(async (request, response) => {
    const quote = await salesService.acceptQuotation(request.auth!, request.params.id!, request);
    sendSuccess(response, "Quotation accepted successfully", quote);
  }),

  rejectQuotation: asyncHandler(async (request, response) => {
    const quote = await salesService.rejectQuotation(request.auth!, request.params.id!, request.body.notes || "", request);
    sendSuccess(response, "Quotation rejected successfully", quote);
  }),

  convertQuotation: asyncHandler(async (request, response) => {
    const order = await salesService.convertQuotation(request.auth!, request.params.id!, request);
    sendSuccess(response, "Quotation converted to order successfully", order);
  }),

  approveOrder: asyncHandler(async (request, response) => {
    const order = await salesService.approveOrder(request.auth!, request.params.id!, request);
    sendSuccess(response, "Order approved successfully", order);
  }),

  fulfilOrder: asyncHandler(async (request, response) => {
    const order = await salesService.fulfilOrder(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Order fulfilled successfully", order);
  }),

  invoiceOrder: asyncHandler(async (request, response) => {
    const invoice = await salesService.invoiceOrder(request.auth!, request.params.id!, request);
    sendSuccess(response, "Invoice generated successfully", invoice);
  }),

  cancelOrder: asyncHandler(async (request, response) => {
    const order = await salesService.cancelOrder(request.auth!, request.params.id!, request);
    sendSuccess(response, "Order cancelled successfully", order);
  }),

  payInvoice: asyncHandler(async (request, response) => {
    const invoice = await salesService.payInvoice(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Payment registered on invoice successfully", invoice);
  }),

  generateInvoice: asyncHandler(async (request, response) => {
    const invoice = await salesService.generateInvoice(request.auth!, request.params.id!, request);
    sendSuccess(response, "Invoice generated successfully", invoice);
  }),

  listDiscountRequests: asyncHandler(async (request, response) => {
    sendSuccess(response, "Discount requests fetched", await salesService.listDiscountRequests(request.auth!, request.query));
  }),

  createDiscountRequest: asyncHandler(async (request, response) => {
    sendSuccess(response, "Discount request submitted", await salesService.createDiscountRequest(request.auth!, request.body, request));
  }),

  approveDiscountRequest: asyncHandler(async (request, response) => {
    sendSuccess(response, "Discount request approved", await salesService.approveDiscountRequest(request.auth!, request.params.id!, request));
  }),

  rejectDiscountRequest: asyncHandler(async (request, response) => {
    sendSuccess(response, "Discount request rejected", await salesService.rejectDiscountRequest(request.auth!, request.params.id!, request.body.reason, request));
  })
};
