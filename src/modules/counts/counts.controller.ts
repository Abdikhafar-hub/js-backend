import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { countsService } from "./counts.service.js";

export const countsController = {
  list: asyncHandler(async (request, response) => {
    const list = await countsService.list(request.auth!, request.query);
    sendSuccess(response, "Stock counts fetched successfully", list);
  }),

  get: asyncHandler(async (request, response) => {
    const count = await countsService.get(request.auth!, request.params.id!);
    sendSuccess(response, "Stock count fetched successfully", count);
  }),

  create: asyncHandler(async (request, response) => {
    const count = await countsService.create(request.auth!, request.body, request);
    sendSuccess(response, "Stock count created successfully", count);
  }),

  updateItems: asyncHandler(async (request, response) => {
    const count = await countsService.updateItems(request.auth!, request.params.id!, request.body.items, request);
    sendSuccess(response, "Stock count items updated successfully", count);
  }),

  start: asyncHandler(async (request, response) => {
    const count = await countsService.start(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock count started", count);
  }),

  submit: asyncHandler(async (request, response) => {
    const count = await countsService.submit(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock count submitted", count);
  }),

  requestRecount: asyncHandler(async (request, response) => {
    const count = await countsService.requestRecount(request.auth!, request.params.id!, request.body.itemIds, request);
    sendSuccess(response, "Recount requested successfully", count);
  }),

  approve: asyncHandler(async (request, response) => {
    const count = await countsService.approve(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock count approved", count);
  }),

  post: asyncHandler(async (request, response) => {
    const count = await countsService.post(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock count posted successfully", count);
  })
};
