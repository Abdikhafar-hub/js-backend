import { describe, expect, it } from "vitest";
import {
  processReturnSchema,
  initiateStkPushSchema,
  resolveReconciliationSchema,
  reversePaymentSchema,
  saveMpesaConfigSchema
} from "../src/modules/payments/payments.schemas.js";
import {
  adjustLoyaltyPointsSchema,
  saveLoyaltyProgramSchema
} from "../src/modules/loyalty/loyalty.schemas.js";

describe("Phase 4 - Returns & Refunds Schemas", () => {
  it("validates process return correctly", () => {
    const payload = {
      body: {
        invoiceId: "inv-123",
        reason: "Defective perfume cap",
        items: [
          { invoiceItemId: "item-1", productVariantId: "var-1", quantity: 2 }
        ],
        refundMethod: "CASH"
      }
    };
    const result = processReturnSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("fails process return if items are empty", () => {
    const payload = {
      body: {
        invoiceId: "inv-123",
        reason: "No items",
        items: [],
        refundMethod: "STORE_CREDIT"
      }
    };
    const result = processReturnSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

describe("Phase 4 - M-Pesa & Reversals Schemas", () => {
  it("validates STK Push inputs", () => {
    const payload = {
      body: {
        phoneNumber: "254712345678",
        amount: 2500,
        invoiceId: "inv-999",
        idempotencyKey: "test-idempotency-key"
      }
    };
    const result = initiateStkPushSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("validates reconciliation resolution", () => {
    const payload = {
      body: {
        reconciliationId: "rec-abc",
        status: "MANUAL_RESOLVED",
        notes: "Mismatched amount paid manually in store"
      }
    };
    const result = resolveReconciliationSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("validates payment reversal schema", () => {
    const payload = {
      body: {
        reason: "Bounced bank cheque"
      }
    };
    const result = reversePaymentSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("validates M-Pesa API integration settings configuration", () => {
    const payload = {
      body: {
        shortcode: "174379",
        consumerKey: "daraja-key",
        consumerSecret: "daraja-secret",
        passkey: "daraja-passkey",
        environment: "sandbox",
        callbackUrl: "https://aura.co.ke/callback"
      }
    };
    const result = saveMpesaConfigSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

describe("Phase 4 - Customer Loyalty Rewards Program Schemas", () => {
  it("validates manual point adjustments", () => {
    const payload = {
      body: {
        customerId: "cust-555",
        points: -100,
        reason: "Manual correction of double checkout entries"
      }
    };
    const result = adjustLoyaltyPointsSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("validates loyalty program configuration", () => {
    const payload = {
      body: {
        loyaltyEnabled: true,
        earningRatio: 100,
        redemptionRatio: 1
      }
    };
    const result = saveLoyaltyProgramSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
