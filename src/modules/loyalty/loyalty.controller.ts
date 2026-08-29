import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { loyaltyService } from "./loyalty.service.js";

export const loyaltyController = {
  getHistory: asyncHandler(async (request, response) => {
    const history = await loyaltyService.getLoyaltyHistory(request.auth!, request.params.customerId!);
    sendSuccess(response, "Loyalty points history fetched successfully", history);
  }),

  redeem: asyncHandler(async (request, response) => {
    const res = await loyaltyService.redeemPoints(request.auth!, request.body, request);
    sendSuccess(response, "Loyalty points redeemed successfully", res);
  }),

  listPrograms: asyncHandler(async (request, response) => {
    const res = await loyaltyService.listPrograms(request.auth!);
    sendSuccess(response, "Loyalty programs fetched successfully", res);
  }),

  saveProgram: asyncHandler(async (request, response) => {
    const res = await loyaltyService.saveProgram(request.auth!, request.body);
    sendSuccess(response, "Loyalty program saved successfully", res);
  }),

  adjustPoints: asyncHandler(async (request, response) => {
    const res = await loyaltyService.adjustPoints(request.auth!, request.body, request);
    sendSuccess(response, "Loyalty points adjusted successfully", res);
  })
};
