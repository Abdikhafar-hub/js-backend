import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { catalogService } from "./catalog.service.js";
import { shapeOperationalResponse } from "../../lib/response-scope.js";

export const catalogController = {
  listBrands: asyncHandler(async (request, response) => {
    sendSuccess(response, "Brands fetched successfully", await catalogService.listBrands(request.auth!));
  }),
  createBrand: asyncHandler(async (request, response) => {
    sendSuccess(response, "Brand created successfully", await catalogService.createBrand(request.auth!, request.body, request));
  }),
  updateBrand: asyncHandler(async (request, response) => {
    sendSuccess(response, "Brand updated successfully", await catalogService.updateBrand(request.auth!, request.params.id!, request.body, request));
  }),
  listCategories: asyncHandler(async (request, response) => {
    sendSuccess(response, "Categories fetched successfully", await catalogService.listCategories(request.auth!));
  }),
  createCategory: asyncHandler(async (request, response) => {
    sendSuccess(response, "Category created successfully", await catalogService.createCategory(request.auth!, request.body, request));
  }),
  updateCategory: asyncHandler(async (request, response) => {
    sendSuccess(response, "Category updated successfully", await catalogService.updateCategory(request.auth!, request.params.id!, request.body, request));
  }),
  deleteCategory: asyncHandler(async (request, response) => {
    sendSuccess(response, "Category deleted successfully", await catalogService.deleteCategory(request.auth!, request.params.id!, request));
  }),
  listProducts: asyncHandler(async (request, response) => {
    sendSuccess(response, "Products fetched successfully", shapeOperationalResponse(request.auth!, await catalogService.listProducts(request.auth!, {
      search: typeof request.query.search === "string" ? request.query.search : undefined,
      branchId: typeof request.query.branchId === "string" ? request.query.branchId : undefined,
      approvalStatus: typeof request.query.approvalStatus === "string" ? request.query.approvalStatus : undefined,
      active: typeof request.query.active === "string" ? request.query.active : undefined,
      createdByBranchManager: typeof request.query.createdByBranchManager === "string" ? request.query.createdByBranchManager : undefined,
      originatingBranchId: typeof request.query.originatingBranchId === "string" ? request.query.originatingBranchId : undefined,
      brandId: typeof request.query.brandId === "string" ? request.query.brandId : undefined,
      categoryId: typeof request.query.categoryId === "string" ? request.query.categoryId : undefined,
      productType: typeof request.query.productType === "string" ? request.query.productType : undefined,
      missingBarcode: typeof request.query.missingBarcode === "string" ? request.query.missingBarcode : undefined,
      duplicateSuspected: typeof request.query.duplicateSuspected === "string" ? request.query.duplicateSuspected : undefined
    })));
  }),
  createProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product created successfully", await catalogService.createProduct(request.auth!, request.body, request));
  }),
  getProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product fetched successfully", shapeOperationalResponse(request.auth!, await catalogService.getProduct(request.auth!, request.params.id!)));
  }),
  updateProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product updated successfully", await catalogService.updateProduct(request.auth!, request.params.id!, request.body, request));
  }),
  createVariant: asyncHandler(async (request, response) => {
    sendSuccess(
      response,
      "Product variant created successfully",
      await catalogService.createVariant(request.auth!, request.params.id!, request.body, request)
    );
  }),
  updateVariant: asyncHandler(async (request, response) => {
    sendSuccess(
      response,
      "Product variant updated successfully",
      await catalogService.updateVariant(request.auth!, request.params.variantId!, request.body, request)
    );
  }),
  submitProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product submitted successfully", await catalogService.submitProduct(request.auth!, request.params.id!, request));
  }),
  listProductSubmissions: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product submissions fetched successfully", shapeOperationalResponse(request.auth!, await catalogService.listProductSubmissions(request.auth!, {
      status: typeof request.query.status === "string" ? request.query.status : undefined,
      type: typeof request.query.type === "string" ? request.query.type : undefined
    })));
  }),
  getProductSubmission: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product submission fetched successfully", shapeOperationalResponse(request.auth!, await catalogService.getProductSubmission(request.auth!, request.params.submissionId!)));
  }),
  approveProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product approved successfully", await catalogService.approveProduct(request.auth!, request.params.id!, request.body, request));
  }),
  rejectProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product rejected successfully", await catalogService.rejectProduct(request.auth!, request.params.id!, request.body, request));
  }),
  requestCorrection: asyncHandler(async (request, response) => {
    sendSuccess(response, "Correction requested successfully", await catalogService.requestCorrection(request.auth!, request.params.id!, request.body, request));
  }),
  mergeProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Product merged successfully", await catalogService.mergeProduct(request.auth!, request.params.id!, request.body, request));
  }),
  requestBranchActivation: asyncHandler(async (request, response) => {
    sendSuccess(response, "Branch activation request created successfully", await catalogService.requestBranchActivation(request.auth!, request.params.id!, request.body, request));
  }),
  activateBranchProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Branch product activated successfully", await catalogService.activateBranchProduct(request.auth!, request.params.id!, request.params.branchId!, request.body, request));
  }),
  updateBranchProduct: asyncHandler(async (request, response) => {
    sendSuccess(response, "Branch product updated successfully", await catalogService.updateBranchProduct(request.auth!, request.params.id!, request.params.branchId!, request.body, request));
  }),
  variantStock: asyncHandler(async (request, response) => {
    sendSuccess(response, "Variant stock fetched successfully", shapeOperationalResponse(request.auth!, await catalogService.variantStock(request.auth!, request.params.variantId!)));
  }),
  findByBarcode: asyncHandler(async (request, response) => {
    sendSuccess(response, "Variant fetched successfully", shapeOperationalResponse(request.auth!, await catalogService.findByBarcode(
      request.auth!, request.params.barcode!, typeof request.query.branchId === "string" ? request.query.branchId : undefined
    )));
  }),
  addVariantBarcode: asyncHandler(async (request, response) => {
    sendSuccess(
      response,
      "Variant barcode added successfully",
      await catalogService.addVariantBarcode(request.auth!, request.params.variantId!, request.body.barcode, request)
    );
  }),
  listPriceLists: asyncHandler(async (request, response) => {
    sendSuccess(response, "Price lists fetched successfully", shapeOperationalResponse(request.auth!, await catalogService.listPriceLists(request.auth!)));
  }),
  createPriceList: asyncHandler(async (request, response) => {
    sendSuccess(response, "Price list created successfully", await catalogService.createPriceList(request.auth!, request.body));
  }),
  updatePriceList: asyncHandler(async (request, response) => {
    sendSuccess(response, "Price list updated successfully", await catalogService.updatePriceList(request.auth!, request.params.id!, request.body));
  }),
  addPriceListItem: asyncHandler(async (request, response) => {
    sendSuccess(
      response,
      "Price list item created successfully",
      await catalogService.addPriceListItem(request.auth!, request.params.id!, request.body)
    );
  })
};
