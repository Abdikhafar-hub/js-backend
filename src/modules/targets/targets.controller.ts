import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { targetsService } from "./targets.service.js";

export const targetsController = {
  list: asyncHandler(async (request, response) => {
    const list = await targetsService.list(request.auth!);
    sendSuccess(response, "Sales targets fetched successfully", list);
  }),

  getPerformance: asyncHandler(async (request, response) => {
    const res = await targetsService.getPerformance(request.auth!, request.params.id!);
    sendSuccess(response, "Target performance calculated successfully", res);
  }),

  getMyPerformance: asyncHandler(async (request, response) => {
    const res = await targetsService.getMyPerformance(request.auth!, request.query);
    sendSuccess(response, "Personal performance calculated successfully", res);
  }),

  getAttendantPerformance: asyncHandler(async (request, response) => {
    const res = await targetsService.getAttendantPerformance(request.auth!, request.query);
    sendSuccess(response, "Attendant performance calculated successfully", res);
  }),

  create: asyncHandler(async (request, response) => {
    const target = await targetsService.create(request.auth!, request.body, request);
    sendSuccess(response, "Sales target created successfully", target);
  })
};
