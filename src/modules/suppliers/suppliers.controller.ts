import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { suppliersService } from "./suppliers.service.js";

export const suppliersController = {
  lookup: asyncHandler(async (request, response) => {
    sendSuccess(response, "Supplier lookup fetched successfully", await suppliersService.lookup(request.auth!));
  }),

  list: asyncHandler(async (request, response) => {
    const list = await suppliersService.list(request.auth!);
    sendSuccess(response, "Suppliers fetched successfully", list);
  }),

  get: asyncHandler(async (request, response) => {
    const supplier = await suppliersService.get(request.auth!, request.params.id!);
    sendSuccess(response, "Supplier fetched successfully", supplier);
  }),

  create: asyncHandler(async (request, response) => {
    const supplier = await suppliersService.create(request.auth!, request.body, request);
    sendSuccess(response, "Supplier created successfully", supplier);
  }),

  update: asyncHandler(async (request, response) => {
    const supplier = await suppliersService.update(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Supplier updated successfully", supplier);
  }),

  addContact: asyncHandler(async (request, response) => {
    const contact = await suppliersService.addContact(request.auth!, request.params.id!, request.body);
    sendSuccess(response, "Contact added successfully", contact);
  }),

  recordPayment: asyncHandler(async (request, response) => {
    const res = await suppliersService.recordPayment(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Supplier payment recorded successfully", res);
  }),

  getLedger: asyncHandler(async (request, response) => {
    const ledger = await suppliersService.getLedger(request.auth!, request.params.id!);
    sendSuccess(response, "Supplier ledger fetched successfully", ledger);
  })
};
