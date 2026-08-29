import { Router } from "express";
import { z } from "zod";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { inventoryController } from "./inventory.controller.js";

const branchParamSchema = z.object({
  params: z.object({
    branchId: z.string().cuid()
  })
});

const variantParamSchema = z.object({
  params: z.object({
    variantId: z.string().cuid()
  })
});

const inventoryQuerySchema = z.object({
  query: z.object({
    branchId: z.string().cuid().optional()
  })
});

const productStockQuerySchema = z.object({
  query: z.object({
    branchId: z.string().cuid(),
    productVariantId: z.string().cuid()
  })
});

export const inventoryRouter = Router();

inventoryRouter.use(authenticate);
inventoryRouter.use(requirePermission(PERMISSIONS.inventoryRead));
inventoryRouter.get("/", inventoryController.list);
inventoryRouter.get("/product-stock", validateRequest(productStockQuerySchema), inventoryController.productStock);
inventoryRouter.get("/branch/:branchId", validateRequest(branchParamSchema), inventoryController.byBranch);
inventoryRouter.get("/product/:variantId", validateRequest(variantParamSchema), inventoryController.byVariant);
inventoryRouter.get("/movements", validateRequest(inventoryQuerySchema), inventoryController.movements);
inventoryRouter.get("/low-stock", validateRequest(inventoryQuerySchema), inventoryController.lowStock);
inventoryRouter.get("/valuation", requirePermission(PERMISSIONS.inventoryValuation), validateRequest(inventoryQuerySchema), inventoryController.valuation);
