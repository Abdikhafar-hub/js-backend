import { LandedCostAllocationMethod } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { landedCostService } from "../src/services/landed-cost.service.js";

describe("landedCostService.allocateCosts", () => {
  it("allocates costs by quantity", () => {
    const allocations = landedCostService.allocateCosts(
      [
        { productVariantId: "a", quantity: 2, unitCost: 10 },
        { productVariantId: "b", quantity: 1, unitCost: 10 }
      ],
      [{ amount: 300, exchangeRate: 1, allocationMethod: LandedCostAllocationMethod.BY_QUANTITY }]
    );

    expect(allocations).toEqual({
      a: 200,
      b: 100
    });
  });

  it("allocates costs by purchase value", () => {
    const allocations = landedCostService.allocateCosts(
      [
        { productVariantId: "a", quantity: 2, unitCost: 50 },
        { productVariantId: "b", quantity: 1, unitCost: 100 }
      ],
      [{ amount: 90, exchangeRate: 1, allocationMethod: LandedCostAllocationMethod.BY_PURCHASE_VALUE }]
    );

    expect(allocations).toEqual({
      a: 45,
      b: 45
    });
  });

  it("falls back to quantity when weight allocation has no weights", () => {
    const allocations = landedCostService.allocateCosts(
      [
        { productVariantId: "a", quantity: 3, unitCost: 10, weight: 0 },
        { productVariantId: "b", quantity: 1, unitCost: 10, weight: 0 }
      ],
      [{ amount: 40, exchangeRate: 1, allocationMethod: LandedCostAllocationMethod.BY_WEIGHT }]
    );

    expect(allocations).toEqual({
      a: 30,
      b: 10
    });
  });
});
