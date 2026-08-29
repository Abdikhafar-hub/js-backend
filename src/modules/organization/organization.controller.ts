import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { organizationService } from "./organization.service.js";

export const organizationController = {
  get: asyncHandler(async (request, response) => {
    const organization = await organizationService.get(request.auth!);
    sendSuccess(response, "Organization fetched successfully", organization);
  }),
  update: asyncHandler(async (request, response) => {
    const organization = await organizationService.update(request.auth!, request.body, request);
    sendSuccess(response, "Organization updated successfully", organization);
  }),
  getSettings: asyncHandler(async (request, response) => {
    const settings = await organizationService.getSettings(request.auth!);
    sendSuccess(response, "Organization settings fetched successfully", settings);
  }),
  updateSettings: asyncHandler(async (request, response) => {
    const settings = await organizationService.updateSettings(request.auth!, request.body, request);
    sendSuccess(response, "Organization settings updated successfully", settings);
  })
};
