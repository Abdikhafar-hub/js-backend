import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { transfersService } from "./transfers.service.js";

export const transfersController = {
  listOptions: asyncHandler(async (request, response) => {
    const options = await transfersService.listOptions(request.auth!, request.query);
    sendSuccess(response, "Stock transfer options fetched successfully", options);
  }),

  list: asyncHandler(async (request, response) => {
    const list = await transfersService.list(request.auth!, request.query);
    sendSuccess(response, "Stock transfers fetched successfully", list);
  }),

  get: asyncHandler(async (request, response) => {
    const transfer = await transfersService.get(request.auth!, request.params.id!);
    sendSuccess(response, "Stock transfer fetched successfully", transfer);
  }),

  create: asyncHandler(async (request, response) => {
    const transfer = await transfersService.create(request.auth!, request.body, request);
    sendSuccess(response, "Stock transfer created successfully", transfer);
  }),

  submit: asyncHandler(async (request, response) => {
    const transfer = await transfersService.submit(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock transfer submitted successfully", transfer);
  }),

  approve: asyncHandler(async (request, response) => {
    const transfer = await transfersService.approve(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Stock transfer approved successfully", transfer);
  }),

  startPicking: asyncHandler(async (request, response) => {
    const transfer = await transfersService.startPicking(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock transfer picking started successfully", transfer);
  }),

  dispatch: asyncHandler(async (request, response) => {
    const transfer = await transfersService.dispatch(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock transfer dispatched successfully", transfer);
  }),

  receive: asyncHandler(async (request, response) => {
    const transfer = await transfersService.receive(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Stock transfer received successfully", transfer);
  })
};
