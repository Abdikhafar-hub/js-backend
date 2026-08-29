import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { inventoryService } from "./inventory.service.js";
import { shapeOperationalResponse } from "../../lib/response-scope.js";

export const inventoryController = {
  list: asyncHandler(async (request, response) => {
    sendSuccess(response, "Inventory fetched successfully", shapeOperationalResponse(request.auth!, await inventoryService.list(request.auth!)));
  }),
  productStock: asyncHandler(async (request, response) => {
    const branchId = request.query.branchId as string;
    const productVariantId = request.query.productVariantId as string;
    sendSuccess(
      response,
      "Product stock details fetched successfully",
      await inventoryService.productStock(request.auth!, branchId, productVariantId)
    );
  }),
  byBranch: asyncHandler(async (request, response) => {
    sendSuccess(response, "Branch inventory fetched successfully", shapeOperationalResponse(request.auth!, await inventoryService.byBranch(request.auth!, request.params.branchId!)));
  }),
  byVariant: asyncHandler(async (request, response) => {
    sendSuccess(response, "Variant inventory fetched successfully", shapeOperationalResponse(request.auth!, await inventoryService.byVariant(request.auth!, request.params.variantId!)));
  }),
  movements: asyncHandler(async (request, response) => {
    sendSuccess(
      response,
      "Inventory movements fetched successfully",
      shapeOperationalResponse(request.auth!, await inventoryService.movements(request.auth!, request.query.branchId as string | undefined))
    );
  }),
  lowStock: asyncHandler(async (request, response) => {
    sendSuccess(
      response,
      "Low stock records fetched successfully",
      shapeOperationalResponse(request.auth!, await inventoryService.lowStock(request.auth!, request.query.branchId as string | undefined))
    );
  }),
  valuation: asyncHandler(async (request, response) => {
    sendSuccess(
      response,
      "Inventory valuation fetched successfully",
      await inventoryService.valuation(request.auth!, request.query.branchId as string | undefined)
    );
  })
};
