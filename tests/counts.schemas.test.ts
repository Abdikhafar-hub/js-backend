import { describe, expect, it } from "vitest";
import { createStockCountSchema, updateStockCountItemsSchema, requestRecountSchema } from "../src/modules/counts/counts.schemas.js";

describe("Counts Module Validation Schemas", () => {
  describe("createStockCountSchema", () => {
    it("validates a correct full count configuration", () => {
      const payload = {
        body: {
          branchId: "branch-id",
          countType: "FULL",
          blindCount: true,
          scheduledAt: "2026-07-14T10:00:00.000Z",
          assignedUserIds: ["user-1", "user-2"]
        }
      };
      const parsed = createStockCountSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it("validates a correct CATEGORY count configuration", () => {
      const payload = {
        body: {
          branchId: "branch-id",
          countType: "CATEGORY",
          categoryId: "cat-1",
          blindCount: false
        }
      };
      const parsed = createStockCountSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it("validates a correct SPOT count configuration with variant IDs", () => {
      const payload = {
        body: {
          branchId: "branch-id",
          countType: "SPOT",
          productVariantIds: ["variant-1", "variant-2"]
        }
      };
      const parsed = createStockCountSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it("fails if countType is invalid", () => {
      const payload = {
        body: {
          branchId: "branch-id",
          countType: "INVALID_TYPE"
        }
      };
      const parsed = createStockCountSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
    });
  });

  describe("updateStockCountItemsSchema", () => {
    it("validates nullable/blank physical quantities", () => {
      const payload = {
        body: {
          items: [
            { id: "item-1", countedQuantity: null, notes: "uncounted" },
            { id: "item-2", countedQuantity: 12.5, notes: "counted" }
          ]
        }
      };
      const parsed = updateStockCountItemsSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it("fails if items list is empty", () => {
      const payload = {
        body: {
          items: []
        }
      };
      const parsed = updateStockCountItemsSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
    });

    it("fails if quantity is negative", () => {
      const payload = {
        body: {
          items: [
            { id: "item-1", countedQuantity: -5 }
          ]
        }
      };
      const parsed = updateStockCountItemsSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
    });
  });

  describe("requestRecountSchema", () => {
    it("validates array of itemIds", () => {
      const payload = {
        body: {
          itemIds: ["item-1", "item-2"]
        }
      };
      const parsed = requestRecountSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it("fails if itemIds array is empty", () => {
      const payload = {
        body: {
          itemIds: []
        }
      };
      const parsed = requestRecountSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
    });
  });
});
