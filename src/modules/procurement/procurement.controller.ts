import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { procurementService } from "./procurement.service.js";

export const procurementController = {
  // Requisitions
  listRequisitions: asyncHandler(async (request, response) => {
    const list = await procurementService.listRequisitions(request.auth!, request.query);
    sendSuccess(response, "Requisitions fetched successfully", list);
  }),

  getRequisition: asyncHandler(async (request, response) => {
    const req = await procurementService.getRequisition(request.auth!, request.params.id!);
    sendSuccess(response, "Requisition fetched successfully", req);
  }),

  createRequisition: asyncHandler(async (request, response) => {
    const req = await procurementService.createRequisition(request.auth!, request.body, request);
    sendSuccess(response, "Requisition created successfully", req);
  }),

  submitRequisition: asyncHandler(async (request, response) => {
    const req = await procurementService.submitRequisition(request.auth!, request.params.id!, request);
    sendSuccess(response, "Requisition submitted successfully", req);
  }),

  approveRequisition: asyncHandler(async (request, response) => {
    const req = await procurementService.approveRequisition(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Requisition approved successfully", req);
  }),

  rejectRequisition: asyncHandler(async (request, response) => {
    const req = await procurementService.rejectRequisition(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Requisition rejected successfully", req);
  }),

  convertRequisitionToPO: asyncHandler(async (request, response) => {
    const po = await procurementService.convertRequisitionToPO(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Purchase order created from requisition successfully", po);
  }),

  // Purchase Orders
  listPOs: asyncHandler(async (request, response) => {
    const list = await procurementService.listPOs(request.auth!);
    sendSuccess(response, "Purchase orders fetched successfully", list);
  }),

  getPO: asyncHandler(async (request, response) => {
    const po = await procurementService.getPO(request.auth!, request.params.id!);
    sendSuccess(response, "Purchase order fetched successfully", po);
  }),

  createPO: asyncHandler(async (request, response) => {
    const po = await procurementService.createPO(request.auth!, request.body, request);
    sendSuccess(response, "Purchase order created successfully", po);
  }),

  submitPO: asyncHandler(async (request, response) => {
    const po = await procurementService.submitPO(request.auth!, request.params.id!, request);
    sendSuccess(response, "Purchase order submitted successfully", po);
  }),

  approvePO: asyncHandler(async (request, response) => {
    const po = await procurementService.approvePO(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Purchase order approved successfully", po);
  }),

  sendToSupplier: asyncHandler(async (request, response) => {
    const po = await procurementService.sendToSupplier(request.auth!, request.params.id!, request);
    sendSuccess(response, "Purchase order sent to supplier successfully", po);
  }),

  cancelPO: asyncHandler(async (request, response) => {
    const po = await procurementService.cancelPO(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Purchase order cancelled successfully", po);
  })
};
