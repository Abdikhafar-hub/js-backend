import { describe, expect, it } from "vitest";
import { createCustomerSchema, updateCustomerSchema } from "../src/modules/customers/customers.schemas.js";
import { suspendSchema, cancelSaleSchema, payInvoiceSchema } from "../src/modules/sales/sales.schemas.js";

describe("Phase 3 - Customer Validation Schemas", () => {
  it("validates a correct customer creation payload", () => {
    const payload = {
      body: {
        customerType: "WHOLESALE",
        firstName: "Dunder",
        lastName: "Mifflin",
        businessName: "Mifflin Paper Corp",
        phone: "+254700000000",
        email: "dunder@mifflin.com",
        creditAllowed: true,
        creditLimit: 50000,
        paymentTermsDays: 30
      }
    };
    const parsed = createCustomerSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("fails customer creation if type is missing or invalid", () => {
    const payload = {
      body: {
        firstName: "Dunder",
        customerType: "INVALID_TYPE"
      }
    };
    const parsed = createCustomerSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("validates partial customer update payload", () => {
    const payload = {
      body: {
        lastName: "Schrute",
        creditLimit: 100000
      }
    };
    const parsed = updateCustomerSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});

describe("Phase 3 - POS & Sales Validation Schemas", () => {
  it("validates suspend sale payload", () => {
    const payload = {
      body: {
        branchId: "branch-uuid-1",
        items: [
          { productVariantId: "v1", quantity: 2, unitPrice: 100 }
        ],
        notes: "Lunch break suspend"
      }
    };
    const parsed = suspendSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("validates cancel sale payload", () => {
    const payload = {
      body: {
        reason: "Customer changed mind after billing"
      }
    };
    const parsed = cancelSaleSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("fails cancel sale if reason is missing", () => {
    const payload = {
      body: {}
    };
    const parsed = cancelSaleSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("validates invoice payment allocation payload", () => {
    const payload = {
      body: {
        paymentMethod: "MPESA",
        amount: 1500,
        reference: "MPESA-REF-XYZ"
      }
    };
    const parsed = payInvoiceSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("fails invoice payment if amount is non-positive", () => {
    const payload = {
      body: {
        paymentMethod: "CARD",
        amount: 0
      }
    };
    const parsed = payInvoiceSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});
