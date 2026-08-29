import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { goodsReceiptsService } from "./goods-receipts.service.js";

export const goodsReceiptsController = {
  list: asyncHandler(async (request, response) => {
    const list = await goodsReceiptsService.list(request.auth!, request.query);
    sendSuccess(response, "Goods receipts fetched successfully", list);
  }),
  listEligiblePurchaseOrders: asyncHandler(async (request, response) => {
    const list = await goodsReceiptsService.listEligiblePurchaseOrders(request.auth!, request.query);
    sendSuccess(response, "Eligible purchase orders fetched successfully", list);
  }),

  bootstrapFromPurchaseOrder: asyncHandler(async (request, response) => {
    const payload = await goodsReceiptsService.bootstrapFromPurchaseOrder(
      request.auth!,
      request.params.purchaseOrderId!
    );
    sendSuccess(response, "Goods receipt bootstrap fetched successfully", payload);
  }),

  get: asyncHandler(async (request, response) => {
    const receipt = await goodsReceiptsService.get(request.auth!, request.params.id!);
    sendSuccess(response, "Goods receipt fetched successfully", receipt);
  }),

  create: asyncHandler(async (request, response) => {
    const receipt = await goodsReceiptsService.create(request.auth!, request.body, request);
    sendSuccess(response, "Goods receipt created successfully", receipt);
  }),

  post: asyncHandler(async (request, response) => {
    const receipt = await goodsReceiptsService.post(request.auth!, request.params.id!, request);
    sendSuccess(response, "Goods receipt posted successfully", receipt);
  })
};
