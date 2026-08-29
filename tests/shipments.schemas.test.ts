import { describe, expect, it } from "vitest";

import { addShipmentCostSchema, createShipmentSchema } from "../src/modules/shipments/shipments.schemas.js";

describe("shipment schemas", () => {
  it("accepts shipment currency and exchange rate fields", () => {
    expect(() =>
      createShipmentSchema.parse({
        body: {
          supplierId: "supplier-1",
          purchaseOrderId: "po-1",
          currencyCode: "USD",
          exchangeRate: 129.45
        }
      })
    ).not.toThrow();
  });

  it("accepts landed cost metadata for shipment costs", () => {
    expect(() =>
      addShipmentCostSchema.parse({
        params: { id: "shipment-1" },
        body: {
          costType: "FREIGHT",
          amount: 100,
          currencyCode: "USD",
          exchangeRate: 130,
          allocationMethod: "BY_PURCHASE_VALUE",
          reference: "INV-1001",
          notes: "Ocean freight"
        }
      })
    ).not.toThrow();
  });
});
