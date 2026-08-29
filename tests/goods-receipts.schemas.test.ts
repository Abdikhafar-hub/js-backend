import { describe, expect, it } from "vitest";

import { createGoodsReceiptSchema } from "../src/modules/goods-receipts/goods-receipts.schemas.js";

const buildPayload = () => ({
  body: {
    branchId: "branch-1",
    supplierId: "supplier-1",
    purchaseOrderId: "po-1",
    items: [
      {
        purchaseOrderItemId: "poi-1",
        productVariantId: "variant-1",
        quantityExpected: 10,
        quantityReceived: 5,
        quantityAccepted: 4,
        quantityRejected: 1,
        rejectionReason: "Damaged carton",
        unitCost: 12
      }
    ]
  }
});

describe("createGoodsReceiptSchema", () => {
  it("accepts valid accepted and rejected quantities", () => {
    expect(() => createGoodsReceiptSchema.parse(buildPayload())).not.toThrow();
  });

  it("rejects when accepted plus rejected exceeds received", () => {
    const payload = buildPayload();
    payload.body.items[0]!.quantityAccepted = 4;
    payload.body.items[0]!.quantityRejected = 2;

    expect(() => createGoodsReceiptSchema.parse(payload)).toThrow(/cannot exceed received quantity/i);
  });

  it("requires a rejection reason when rejected quantity is above zero", () => {
    const payload = {
      body: {
        branchId: "branch-1",
        supplierId: "supplier-1",
        purchaseOrderId: "po-1",
        items: [
          {
            purchaseOrderItemId: "poi-1",
            productVariantId: "variant-1",
            quantityExpected: 10,
            quantityReceived: 5,
            quantityAccepted: 4,
            quantityRejected: 1,
            unitCost: 12
          }
        ]
      }
    };

    expect(() => createGoodsReceiptSchema.parse(payload)).toThrow(/rejection reason/i);
  });
});
