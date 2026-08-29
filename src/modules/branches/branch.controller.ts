import { BranchStatus } from "@prisma/client";

import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { branchService } from "./branch.service.js";

export const branchController = {
  list: asyncHandler(async (request, response) => {
    const branches = await branchService.list(request.auth!);
    sendSuccess(response, "Branches fetched successfully", branches);
  }),
  create: asyncHandler(async (request, response) => {
    const branch = await branchService.create(request.auth!, request.body, request);
    sendSuccess(response, "Branch created successfully", branch);
  }),
  assignManager: asyncHandler(async (request, response) => {
    const manager = await branchService.assignManager(
      request.auth!,
      request.params.branchId!,
      request.body,
      request
    );
    sendSuccess(response, "Branch manager assigned successfully", manager);
  }),
  removeManager: asyncHandler(async (request, response) => {
    const manager = await branchService.removeManager(request.auth!, request.params.branchId!, request);
    sendSuccess(response, "Branch manager removed successfully", manager);
  }),
  deactivateManager: asyncHandler(async (request, response) => {
    const manager = await branchService.deactivateManager(request.auth!, request.params.branchId!, request);
    sendSuccess(response, "Branch manager deactivated successfully", manager);
  }),
  get: asyncHandler(async (request, response) => {
    const branch = await branchService.get(request.auth!, request.params.branchId!);
    sendSuccess(response, "Branch fetched successfully", branch);
  }),
  update: asyncHandler(async (request, response) => {
    const branch = await branchService.update(request.auth!, request.params.branchId!, request.body, request);
    sendSuccess(response, "Branch updated successfully", branch);
  }),
  activate: asyncHandler(async (request, response) => {
    const branch = await branchService.changeStatus(
      request.auth!,
      request.params.branchId!,
      BranchStatus.ACTIVE,
      request
    );
    sendSuccess(response, "Branch activated successfully", branch);
  }),
  deactivate: asyncHandler(async (request, response) => {
    const branch = await branchService.changeStatus(
      request.auth!,
      request.params.branchId!,
      BranchStatus.INACTIVE,
      request
    );
    sendSuccess(response, "Branch deactivated successfully", branch);
  }),
  dashboard: asyncHandler(async (request, response) => {
    const dashboard = await branchService.dashboard(request.auth!, request.params.branchId!);
    sendSuccess(response, "Branch dashboard fetched successfully", dashboard);
  })
};
