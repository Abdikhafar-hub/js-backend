import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { auditLogService } from "./audit.service.js";

export const auditController = {
  list: asyncHandler(async (request, response) => {
    sendSuccess(response, "Audit logs fetched successfully", await auditLogService.list(request.auth!));
  }),
  get: asyncHandler(async (request, response) => {
    sendSuccess(response, "Audit log fetched successfully", await auditLogService.get(request.auth!, request.params.id!));
  })
};
