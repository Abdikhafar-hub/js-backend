import { describe, expect, it } from "vitest";

import { createStockAdjustmentSchema } from "../src/modules/stock-adjustments/stock-adjustments.schemas.js";

describe("createStockAdjustmentSchema", () => {
  it("passes a valid stock adjustment creation payload", () => {
    const payload = {
      body: {
        branchId: "branch-uuid-1",
        adjustmentType: "DAMAGE",
        reason: "Perfume broke in transit",
        items: [
          {
            productVariantId: "var-1",
            inventoryBatchId: "batch-1",
            direction: "DECREASE",
            quantity: 3,
            unitCost: 15.5
          }
        ]
      }
    };
    const result = createStockAdjustmentSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("fails if direction is missing or invalid", () => {
    const payload = {
      body: {
        branchId: "branch-uuid-1",
        adjustmentType: "DAMAGE",
        reason: "Perfume broke in transit",
        items: [
          {
            productVariantId: "var-1",
            inventoryBatchId: "batch-1",
            quantity: 3,
            unitCost: 15.5
          }
        ]
      }
    };
    const result = createStockAdjustmentSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("fails if duplicate items (variant + batch combination) are included", () => {
    const payload = {
      body: {
        branchId: "branch-uuid-1",
        adjustmentType: "OTHER",
        reason: "Manual correction",
        items: [
          {
            productVariantId: "var-1",
            inventoryBatchId: "batch-1",
            direction: "INCREASE",
            quantity: 5
          },
          {
            productVariantId: "var-1",
            inventoryBatchId: "batch-1",
            direction: "DECREASE",
            quantity: 2
          }
        ]
      }
    };
    const result = createStockAdjustmentSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]?.message).toContain("Duplicate adjustment lines are not allowed");
    }
  });

  it("allows same variant but different batch ids", () => {
    const payload = {
      body: {
        branchId: "branch-uuid-1",
        adjustmentType: "OTHER",
        reason: "Manual correction",
        items: [
          {
            productVariantId: "var-1",
            inventoryBatchId: "batch-1",
            direction: "INCREASE",
            quantity: 5
          },
          {
            productVariantId: "var-1",
            inventoryBatchId: "batch-2",
            direction: "DECREASE",
            quantity: 2
          }
        ]
      }
    };
    const result = createStockAdjustmentSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
