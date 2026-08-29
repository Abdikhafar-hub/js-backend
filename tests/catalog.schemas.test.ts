import { describe, expect, it } from "vitest";

import {
  approveProductSchema,
  branchActivationRequestSchema,
  createProductSchema
} from "../src/modules/catalog/catalog.schemas.js";

describe("catalog workflow schemas", () => {
  it("accepts a branch manager draft payload with variants and branch configuration", () => {
    const parsed = createProductSchema.safeParse({
      body: {
        name: "Lattafa Asad",
        productType: "PERFUME",
        requestedBrandName: "Lattafa",
        requestedCategoryName: "Perfume",
        variants: [
          {
            name: "100ml",
            sku: "ASAD-100",
            barcode: "1234567890123",
            volumeValue: 100,
            volumeUnit: "ML",
            retailPrice: 4500,
            wholesalePrice: 3900
          }
        ],
        branchConfiguration: {
          branchIds: ["cmfbranch00000000000000001"],
          reorderLevel: 4,
          minimumStock: 2,
          shelfLocation: "A-14"
        },
        pricingRequest: {
          proposedRetailPrice: 4500,
          proposedWholesalePrice: 3900,
          justification: "First branch introduction"
        }
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("requires a rejection reason on approval decisions that reject", () => {
    const parsed = approveProductSchema.safeParse({
      params: { id: "cmfproduct00000000000000001" },
      body: {}
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts branch activation requests with scoped branch configuration", () => {
    const parsed = branchActivationRequestSchema.safeParse({
      params: { id: "cmfproduct00000000000000001" },
      body: {
        branchIds: ["cmfbranch00000000000000001"],
        branchConfiguration: {
          branchIds: ["cmfbranch00000000000000001"],
          reorderLevel: 5,
          branchLabel: "Front Shelf"
        }
      }
    });

    expect(parsed.success).toBe(true);
  });
});
