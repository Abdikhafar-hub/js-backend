import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { goodsReceiptsController } from "./goods-receipts.controller.js";
import { createGoodsReceiptSchema, goodsReceiptBootstrapSchema } from "./goods-receipts.schemas.js";

export const goodsReceiptsRouter = Router();

goodsReceiptsRouter.use(authenticate);

goodsReceiptsRouter.get("/", requirePermission(PERMISSIONS.procurementRequest), goodsReceiptsController.list);
goodsReceiptsRouter.get("/eligible-purchase-orders", requirePermission(PERMISSIONS.procurementReceive), goodsReceiptsController.listEligiblePurchaseOrders);
goodsReceiptsRouter.get(
  "/bootstrap/purchase-orders/:purchaseOrderId",
  requirePermission(PERMISSIONS.procurementRequest),
  validateRequest(goodsReceiptBootstrapSchema),
  goodsReceiptsController.bootstrapFromPurchaseOrder
);
goodsReceiptsRouter.post("/", requirePermission(PERMISSIONS.procurementRequest), validateRequest(createGoodsReceiptSchema), goodsReceiptsController.create);

goodsReceiptsRouter.get("/:id", requirePermission(PERMISSIONS.procurementRequest), goodsReceiptsController.get);
goodsReceiptsRouter.post("/:id/post", requirePermission(PERMISSIONS.procurementReceive), goodsReceiptsController.post);
