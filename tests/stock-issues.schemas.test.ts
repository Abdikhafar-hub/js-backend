import { describe, expect, it } from "vitest";

import {
  convertStockIssueToAdjustmentSchema,
  createStockIssueSchema,
  reviewStockIssueSchema
} from "../src/modules/stock-issues/stock-issues.schemas.js";

describe("stock issue schemas", () => {
  it("accepts stock issue report payloads without cost data", () => {
    expect(() =>
      createStockIssueSchema.parse({
        body: {
          branchId: "branch-1",
          productVariantId: "variant-1",
          quantity: 2,
          issueType: "DAMAGE",
          description: "Broken bottle seal"
        }
      })
    ).not.toThrow();
  });

  it("limits review status actions to review states", () => {
    expect(() =>
      reviewStockIssueSchema.parse({
        params: { id: "issue-1" },
        body: {
          status: "ACCEPTED",
          notes: "Confirmed by branch manager"
        }
      })
    ).not.toThrow();
  });

  it("accepts optional adjustment metadata during conversion", () => {
    expect(() =>
      convertStockIssueToAdjustmentSchema.parse({
        params: { id: "issue-1" },
        body: {
          unitCost: 45.5,
          notes: "Create write-off adjustment"
        }
      })
    ).not.toThrow();
  });
});
