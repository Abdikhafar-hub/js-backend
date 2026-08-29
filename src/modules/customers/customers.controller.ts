import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { customersService } from "./customers.service.js";

export const customersController = {
  listCustomers: asyncHandler(async (request, response) => {
    const list = await customersService.listCustomers(request.auth!, request.query);
    sendSuccess(response, "Customers fetched successfully", list);
  }),

  getCustomer: asyncHandler(async (request, response) => {
    const customer = await customersService.getCustomer(request.auth!, request.params.id!);
    sendSuccess(response, "Customer fetched successfully", customer);
  }),

  createCustomer: asyncHandler(async (request, response) => {
    const customer = await customersService.createCustomer(request.auth!, request.body, request);
    sendSuccess(response, "Customer created successfully", customer);
  }),

  updateCustomer: asyncHandler(async (request, response) => {
    const customer = await customersService.updateCustomer(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Customer updated successfully", customer);
  }),

  updateCredit: asyncHandler(async (request, response) => {
    const customer = await customersService.updateCredit(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Customer credit settings updated successfully", customer);
  }),

  getCustomerLedger: asyncHandler(async (request, response) => {
    const ledger = await customersService.getCustomerLedger(request.auth!, request.params.id!);
    sendSuccess(response, "Customer ledger fetched successfully", ledger);
  }),

  getCustomerSales: asyncHandler(async (request, response) => {
    const sales = await customersService.getCustomerSales(request.auth!, request.params.id!, request.query);
    sendSuccess(response, "Customer sales fetched successfully", sales);
  }),

  getCustomerInvoices: asyncHandler(async (request, response) => {
    const invoices = await customersService.getCustomerInvoices(request.auth!, request.params.id!, request.query);
    sendSuccess(response, "Customer invoices fetched successfully", invoices);
  }),

  getCustomerQuotations: asyncHandler(async (request, response) => {
    const quotations = await customersService.getCustomerQuotations(request.auth!, request.params.id!, request.query);
    sendSuccess(response, "Customer quotations fetched successfully", quotations);
  })
};
