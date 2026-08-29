import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { stockIssuesService } from "./stock-issues.service.js";

export const stockIssuesController = {
  list: asyncHandler(async (request, response) => {
    const issues = await stockIssuesService.list(request.auth!, request.query);
    sendSuccess(response, "Stock issues fetched successfully", issues);
  }),

  get: asyncHandler(async (request, response) => {
    const issue = await stockIssuesService.get(request.auth!, request.params.id!);
    sendSuccess(response, "Stock issue fetched successfully", issue);
  }),

  create: asyncHandler(async (request, response) => {
    const issue = await stockIssuesService.create(request.auth!, request.body, request);
    sendSuccess(response, "Stock issue created successfully", issue);
  }),

  review: asyncHandler(async (request, response) => {
    const issue = await stockIssuesService.review(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Stock issue reviewed successfully", issue);
  }),

  reject: asyncHandler(async (request, response) => {
    const issue = await stockIssuesService.reject(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Stock issue rejected successfully", issue);
  }),

  convertToAdjustment: asyncHandler(async (request, response) => {
    const result = await stockIssuesService.convertToAdjustment(request.auth!, request.params.id!, request.body, request);
    sendSuccess(response, "Stock issue converted to adjustment successfully", result);
  })
};
