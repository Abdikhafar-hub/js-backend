import { Router } from "express";
import multer from "multer";

import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { validateUploadFile } from "../../services/storage/media-validation.js";
import { storefrontController } from "./storefront.controller.js";
import { cartController } from "./cart.controller.js";
import { checkoutController } from "./checkout.controller.js";
import {
  updateStorefrontProfileSchema,
  createCollectionSchema,
  updateCollectionSchema,
  mediaIdParamSchema,
  updateProductMediaSchema,
  collectionIdParamSchema,
  replaceSectionPlacementsSchema,
  replaceSectionContentCardsSchema,
  updateSectionSchema
} from "./storefront.schemas.js";

// Setup multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (_request, file, callback) => {
    try {
      validateUploadFile(
        {
          buffer: Buffer.alloc(0),
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: 0
        },
        "product-image"
      );
      callback(null, true);
    } catch (error) {
      callback(error as Error);
    }
  }
});

export const storefrontRouter = Router();

// ==========================================
// PUBLIC ENDPOINTS (No authentication)
// ==========================================
storefrontRouter.get("/config", storefrontController.getPublicConfig);
storefrontRouter.get("/products", asyncHandler(storefrontController.listPublicProducts));
storefrontRouter.get("/home", asyncHandler(storefrontController.getPublicHome));
storefrontRouter.get("/routes/:slug", asyncHandler(storefrontController.resolvePublicRoute));
storefrontRouter.get("/products/:slug", asyncHandler(storefrontController.getPublicProductBySlug));
storefrontRouter.get("/collections", asyncHandler(storefrontController.listPublicCollections));
storefrontRouter.get("/collections/:slug", asyncHandler(storefrontController.getPublicCollectionBySlug));
storefrontRouter.get("/brands", asyncHandler(storefrontController.listPublicBrands));
storefrontRouter.get("/categories", asyncHandler(storefrontController.listPublicCategories));

// ==========================================
// CART ENDPOINTS
// ==========================================
storefrontRouter.post("/cart", cartController.createCart);
storefrontRouter.get("/cart/:token", cartController.getCart);
storefrontRouter.post("/cart/:token/items", cartController.addItem);
storefrontRouter.put("/cart/:token/items", cartController.updateItem);
storefrontRouter.delete("/cart/:token/items/:variantId", cartController.removeItem);

// ==========================================
// CHECKOUT & ORDER ENDPOINTS
// ==========================================
storefrontRouter.get("/delivery-zones", checkoutController.listActiveDeliveryZones);
storefrontRouter.post("/checkout/preview", checkoutController.preview);
storefrontRouter.post("/checkout/order", checkoutController.placeOrder);
storefrontRouter.get("/orders/:publicToken", checkoutController.getOrderByPublicToken);
storefrontRouter.post("/orders/:publicToken/payment-attempts", checkoutController.initiatePaymentAttempt);
storefrontRouter.get("/orders/:publicToken/payment-status", checkoutController.getPaymentStatus);
storefrontRouter.get("/orders/:publicToken/payment-attempts-history", checkoutController.getPaymentAttemptsHistory);

// ==========================================
// ADMIN ENDPOINTS (General Manager required)
// ==========================================
storefrontRouter.use(authenticate);

storefrontRouter.get(
  "/admin/products",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  asyncHandler(storefrontController.listAdminProducts)
);

storefrontRouter.get(
  "/products/:productId/profile",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  asyncHandler(storefrontController.getStorefrontProfile)
);

storefrontRouter.post(
  "/products/:productId/profile",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(updateStorefrontProfileSchema),
  asyncHandler(storefrontController.updateStorefrontProfile)
);

storefrontRouter.post(
  "/products/:productId/media",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  upload.single("image"),
  asyncHandler(storefrontController.uploadProductMedia)
);

storefrontRouter.delete(
  "/media/:mediaId",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(mediaIdParamSchema),
  asyncHandler(storefrontController.deleteProductMedia)
);

storefrontRouter.patch(
  "/media/:mediaId",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(updateProductMediaSchema),
  asyncHandler(storefrontController.updateProductMedia)
);

storefrontRouter.put(
  "/media/:mediaId/file",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(mediaIdParamSchema),
  upload.single("image"),
  asyncHandler(storefrontController.replaceProductMedia)
);

storefrontRouter.post(
  "/collections",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(createCollectionSchema),
  asyncHandler(storefrontController.createCollection)
);

storefrontRouter.get(
  "/admin/collections",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  asyncHandler(storefrontController.listAdminCollections)
);

storefrontRouter.get(
  "/admin/collections/:collectionId",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(collectionIdParamSchema),
  asyncHandler(storefrontController.getAdminCollection)
);

storefrontRouter.patch(
  "/collections/:collectionId",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(updateCollectionSchema),
  asyncHandler(storefrontController.updateCollection)
);

storefrontRouter.delete(
  "/collections/:collectionId",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(collectionIdParamSchema),
  asyncHandler(storefrontController.deleteCollection)
);

storefrontRouter.get(
  "/admin/sections",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  asyncHandler(storefrontController.listAdminSections)
);

storefrontRouter.patch(
  "/sections/:sectionKey",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(updateSectionSchema),
  asyncHandler(storefrontController.updateSection)
);

storefrontRouter.put(
  "/sections/:sectionKey/placements",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(replaceSectionPlacementsSchema),
  asyncHandler(storefrontController.replaceSectionPlacements)
);

storefrontRouter.put(
  "/sections/:sectionKey/content-cards",
  requirePermission(PERMISSIONS.storefrontCatalogManage),
  validateRequest(replaceSectionContentCardsSchema),
  asyncHandler(storefrontController.replaceSectionContentCards)
);
