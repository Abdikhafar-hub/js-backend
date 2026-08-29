import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { stockAdjustmentsService } from "./stock-adjustments.service.js";

export const stockAdjustmentsController = {
  list: asyncHandler(async (request, response) => {
    const list = await stockAdjustmentsService.list(request.auth!, request.query);
    sendSuccess(response, "Stock adjustments fetched successfully", list);
  }),

  get: asyncHandler(async (request, response) => {
    const adjustment = await stockAdjustmentsService.get(request.auth!, request.params.id!);
    sendSuccess(response, "Stock adjustment fetched successfully", adjustment);
  }),

  create: asyncHandler(async (request, response) => {
    const adjustment = await stockAdjustmentsService.create(request.auth!, request.body, request);
    sendSuccess(response, "Stock adjustment created successfully", adjustment);
  }),

  submit: asyncHandler(async (request, response) => {
    const adjustment = await stockAdjustmentsService.submit(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock adjustment submitted successfully", adjustment);
  }),

  approve: asyncHandler(async (request, response) => {
    const adjustment = await stockAdjustmentsService.approve(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Stock adjustment approved successfully", adjustment);
  }),

  reject: asyncHandler(async (request, response) => {
    const adjustment = await stockAdjustmentsService.reject(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Stock adjustment rejected successfully", adjustment);
  }),

  post: asyncHandler(async (request, response) => {
    const adjustment = await stockAdjustmentsService.post(request.auth!, request.params.id!, request);
    sendSuccess(response, "Stock adjustment posted successfully", adjustment);
  }),

  cancel: asyncHandler(async (request, response) => {
    const adjustment = await stockAdjustmentsService.cancel(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Stock adjustment cancelled successfully", adjustment);
  })
};
