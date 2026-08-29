import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { shipmentsService } from "./shipments.service.js";

export const shipmentsController = {
  list: asyncHandler(async (request, response) => {
    const list = await shipmentsService.list(request.auth!);
    sendSuccess(response, "Import shipments fetched successfully", list);
  }),

  get: asyncHandler(async (request, response) => {
    const shipment = await shipmentsService.get(request.auth!, request.params.id!);
    sendSuccess(response, "Import shipment fetched successfully", shipment);
  }),

  create: asyncHandler(async (request, response) => {
    const shipment = await shipmentsService.create(request.auth!, request.body, request);
    sendSuccess(response, "Import shipment created successfully", shipment);
  }),

  addCost: asyncHandler(async (request, response) => {
    const res = await shipmentsService.addCost(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Landed cost added successfully", res);
  }),

  updateStatus: asyncHandler(async (request, response) => {
    const shipment = await shipmentsService.updateStatus(request.auth!, request.params.id!, request.body.status, request);
    sendSuccess(response, "Shipment status updated successfully", shipment);
  })
};
