import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const submitProduct = vi.fn(async () => ({
  product: { id: "cmfproduct00000000000000001", approvalStatus: "PENDING_APPROVAL" },
  submission: { id: "cmfsubmission000000000000001", status: "PENDING_APPROVAL" }
}));

const approveProduct = vi.fn(async () => ({
  id: "cmfproduct00000000000000001",
  approvalStatus: "APPROVED"
}));

vi.mock("../../src/middleware/authenticate.middleware.js", () => ({
  authenticate: (request_: Request, _response: Response, next: NextFunction) => {
    const role = request_.header("x-test-role") === "GENERAL_MANAGER" ? "GENERAL_MANAGER" : "BRANCH_MANAGER";
    request_.auth = {
      userId: role === "GENERAL_MANAGER" ? "gm-1" : "bm-1",
      organizationId: "org-1",
      role,
      sessionId: "session-1",
      tokenVersion: 1,
      branchIds: ["cmfbranch00000000000000001"]
    };
    next();
  }
}));

vi.mock("../../src/modules/catalog/catalog.service.js", () => ({
  catalogService: {
    submitProduct,
    approveProduct,
    listBrands: vi.fn(),
    createBrand: vi.fn(),
    updateBrand: vi.fn(),
    listCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    listProducts: vi.fn(),
    createProduct: vi.fn(),
    getProduct: vi.fn(),
    updateProduct: vi.fn(),
    createVariant: vi.fn(),
    updateVariant: vi.fn(),
    listProductSubmissions: vi.fn(),
    getProductSubmission: vi.fn(),
    rejectProduct: vi.fn(),
    requestCorrection: vi.fn(),
    mergeProduct: vi.fn(),
    requestBranchActivation: vi.fn(),
    activateBranchProduct: vi.fn(),
    updateBranchProduct: vi.fn(),
    variantStock: vi.fn(),
    findByBarcode: vi.fn(),
    addVariantBarcode: vi.fn(),
    listPriceLists: vi.fn(),
    createPriceList: vi.fn(),
    updatePriceList: vi.fn(),
    addPriceListItem: vi.fn()
  }
}));

const { createApp } = await import("../../src/app.js");

describe("catalog product workflow routes", () => {
  beforeEach(() => {
    submitProduct.mockClear();
    approveProduct.mockClear();
  });

  it("allows a branch manager to submit a product draft", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/v1/products/cmfproduct00000000000000001/submit")
      .set("x-test-role", "BRANCH_MANAGER")
      .send({});

    expect(response.status).toBe(200);
    expect(submitProduct).toHaveBeenCalledWith(
      expect.objectContaining({ role: "BRANCH_MANAGER" }),
      "cmfproduct00000000000000001",
      expect.anything()
    );
  });

  it("denies branch managers from approving their own product submissions", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/v1/products/cmfproduct00000000000000001/approve")
      .set("x-test-role", "BRANCH_MANAGER")
      .send({});

    expect(response.status).toBe(403);
    expect(approveProduct).not.toHaveBeenCalled();
  });

  it("allows the general manager approval route to execute", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/v1/products/cmfproduct00000000000000001/approve")
      .set("x-test-role", "GENERAL_MANAGER")
      .send({ reviewNote: "Looks good." });

    expect(response.status).toBe(200);
    expect(approveProduct).toHaveBeenCalledWith(
      expect.objectContaining({ role: "GENERAL_MANAGER" }),
      "cmfproduct00000000000000001",
      { reviewNote: "Looks good." },
      expect.anything()
    );
  });
});
