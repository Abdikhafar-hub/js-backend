import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { catalogController } from "./catalog.controller.js";
import {
  addPriceListItemSchema,
  addVariantBarcodeSchema,
  activateBranchProductSchema,
  barcodeParamSchema,
  branchActivationRequestSchema,
  createBrandSchema,
  createCategorySchema,
  createPriceListSchema,
  createProductSchema,
  createVariantSchema,
  idParamSchema,
  approveProductSchema,
  listProductSubmissionsSchema,
  mergeProductSchema,
  productSubmissionIdParamSchema,
  rejectProductSchema,
  requestCorrectionSchema,
  submitProductSchema,
  updateBrandSchema,
  updateBranchProductSchema,
  updateCategorySchema,
  updatePriceListSchema,
  updateProductSchema,
  updateVariantSchema,
  variantIdParamSchema
} from "./catalog.schemas.js";

export const catalogRouter = Router();

catalogRouter.use(authenticate);

catalogRouter.get("/brands", requirePermission(PERMISSIONS.productRead), catalogController.listBrands);
catalogRouter.post("/brands", requirePermission(PERMISSIONS.productCreate), validateRequest(createBrandSchema), catalogController.createBrand);
catalogRouter.patch("/brands/:id", requirePermission(PERMISSIONS.productUpdate), validateRequest(updateBrandSchema), catalogController.updateBrand);

catalogRouter.get("/categories", requirePermission(PERMISSIONS.productRead), catalogController.listCategories);
catalogRouter.post("/categories", requirePermission(PERMISSIONS.productCreate), validateRequest(createCategorySchema), catalogController.createCategory);
catalogRouter.patch("/categories/:id", requirePermission(PERMISSIONS.productUpdate), validateRequest(updateCategorySchema), catalogController.updateCategory);
catalogRouter.delete("/categories/:id", requirePermission(PERMISSIONS.productUpdate), validateRequest(idParamSchema), catalogController.deleteCategory);

catalogRouter.get("/products", requirePermission(PERMISSIONS.productRead), catalogController.listProducts);
catalogRouter.post("/products", requirePermission(PERMISSIONS.productCreateDraft), validateRequest(createProductSchema), catalogController.createProduct);
catalogRouter.get("/product-submissions", requirePermission(PERMISSIONS.productRead), validateRequest(listProductSubmissionsSchema), catalogController.listProductSubmissions);
catalogRouter.get("/product-submissions/:submissionId", requirePermission(PERMISSIONS.productRead), validateRequest(productSubmissionIdParamSchema), catalogController.getProductSubmission);
catalogRouter.get("/products/:id", requirePermission(PERMISSIONS.productRead), validateRequest(idParamSchema), catalogController.getProduct);
catalogRouter.patch("/products/:id", requirePermission(PERMISSIONS.productUpdateOwnDraft), validateRequest(updateProductSchema), catalogController.updateProduct);
catalogRouter.post("/products/:id/submit", requirePermission(PERMISSIONS.productSubmit), validateRequest(submitProductSchema), catalogController.submitProduct);
catalogRouter.post("/products/:id/approve", requirePermission(PERMISSIONS.productApprove), validateRequest(approveProductSchema), catalogController.approveProduct);
catalogRouter.post("/products/:id/reject", requirePermission(PERMISSIONS.productReject), validateRequest(rejectProductSchema), catalogController.rejectProduct);
catalogRouter.post("/products/:id/request-correction", requirePermission(PERMISSIONS.productRequestCorrection), validateRequest(requestCorrectionSchema), catalogController.requestCorrection);
catalogRouter.post("/products/:id/merge", requirePermission(PERMISSIONS.productMerge), validateRequest(mergeProductSchema), catalogController.mergeProduct);
catalogRouter.post("/products/:id/variants", requirePermission(PERMISSIONS.variantCreateDraft), validateRequest(createVariantSchema), catalogController.createVariant);
catalogRouter.post("/products/:id/branch-activation-request", requirePermission(PERMISSIONS.productAddToBranch), validateRequest(branchActivationRequestSchema), catalogController.requestBranchActivation);
catalogRouter.post("/products/:id/branches/:branchId/activate", requirePermission(PERMISSIONS.productApprove), validateRequest(activateBranchProductSchema), catalogController.activateBranchProduct);
catalogRouter.patch("/products/:id/branches/:branchId", requirePermission(PERMISSIONS.productConfigureBranch), validateRequest(updateBranchProductSchema), catalogController.updateBranchProduct);

catalogRouter.patch("/product-variants/:variantId", requirePermission(PERMISSIONS.productUpdateOwnDraft), validateRequest(updateVariantSchema), catalogController.updateVariant);
catalogRouter.get("/product-variants/:variantId/stock", requirePermission(PERMISSIONS.productRead), validateRequest(variantIdParamSchema), catalogController.variantStock);
catalogRouter.get("/product-variants/barcode/:barcode", requirePermission(PERMISSIONS.productRead), validateRequest(barcodeParamSchema), catalogController.findByBarcode);
catalogRouter.post("/product-variants/:variantId/barcodes", requirePermission(PERMISSIONS.productUpdateOwnDraft), validateRequest(addVariantBarcodeSchema), catalogController.addVariantBarcode);

catalogRouter.get("/price-lists", requirePermission(PERMISSIONS.productRead), catalogController.listPriceLists);
catalogRouter.post("/price-lists", requirePermission(PERMISSIONS.priceUpdate), validateRequest(createPriceListSchema), catalogController.createPriceList);
catalogRouter.patch("/price-lists/:id", requirePermission(PERMISSIONS.priceUpdate), validateRequest(updatePriceListSchema), catalogController.updatePriceList);
catalogRouter.post("/price-lists/:id/items", requirePermission(PERMISSIONS.priceUpdate), validateRequest(addPriceListItemSchema), catalogController.addPriceListItem);
