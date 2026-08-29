import { z } from "zod";

const refundMethodSchema = z.enum(["CASH", "MPESA", "STORE_CREDIT", "CREDIT_NOTE", "BANK_TRANSFER"]);
const refundTypeSchema = z.enum([
  "FULL_ORDER",
  "PARTIAL_ITEM",
  "PARTIAL_AMOUNT",
  "DELIVERY_FEE",
  "OVERPAYMENT",
  "DUPLICATE_PAYMENT",
  "PRICE_CORRECTION",
  "CANCELLED_ORDER",
  "GOODWILL"
]);

const refundItemSchema = z.object({
  saleItemId: z.string().min(1),
  quantity: z.number().positive(),
  reason: z.string().trim().min(1).optional(),
  condition: z.enum(["SEALED", "OPENED", "DAMAGED", "DEFECTIVE"]).default("SEALED"),
  restockDisposition: z.enum(["RESTOCK", "QUARANTINE", "REJECT"]).optional()
});

export const recordPaymentSchema = z.object({
  body: z.object({
    invoiceId: z.string().min(1),
    paymentMethod: z.enum(["CASH", "MPESA", "CARD", "BANK_TRANSFER", "STORE_CREDIT", "CHEQUE", "OTHER"]),
    amount: z.number().positive(),
    reference: z.string().optional(),
    notes: z.string().optional()
  })
});

export const createCreditDebitNoteSchema = z.object({
  body: z.object({
    invoiceId: z.string().min(1),
    customerId: z.string().min(1),
    noteType: z.enum(["CREDIT", "DEBIT"]),
    amount: z.number().positive(),
    reason: z.string().min(1)
  })
});

export const processReturnSchema = z.object({
  body: z.object({
    invoiceId: z.string().min(1),
    reason: z.string().min(1),
    items: z.array(
      z.object({
        invoiceItemId: z.string().min(1),
        productVariantId: z.string().min(1),
        quantity: z.number().positive(),
        condition: z.enum(["SEALED", "OPENED", "DAMAGED", "DEFECTIVE"]).default("SEALED")
      })
    ).min(1),
    refundMethod: z.enum(["CASH", "MPESA", "STORE_CREDIT", "CREDIT_NOTE", "EXCHANGE"])
  })
});

export const createExchangeSchema = z.object({
  body: z.object({
    returnRequestId: z.string().min(1),
    items: z.array(z.object({
      productVariantId: z.string().min(1),
      quantity: z.number().positive()
    })).min(1),
    paymentMethod: z.enum(["CASH", "MPESA", "CARD", "BANK_TRANSFER"]).optional(),
    paymentReference: z.string().min(2).optional(),
    paymentAmount: z.number().positive().optional(),
    reason: z.string().min(3),
    idempotencyKey: z.string().min(8).max(128)
  })
});

export const reviewReturnSchema = z.object({
  body: z.object({ notes: z.string().min(3) })
});

export const inspectReturnSchema = z.object({
  body: z.object({
    notes: z.string().min(3),
    items: z.array(z.object({
      itemId: z.string().min(1),
      disposition: z.enum(["RESTOCK", "QUARANTINE", "REJECT"]),
      inspectionNotes: z.string().optional()
    })).min(1)
  })
});

export const rejectReturnSchema = z.object({
  body: z.object({ reason: z.string().min(3) })
});

export const approveRefundSchema = z.object({
  body: z.object({
    approvedAmount: z.number().positive().optional(),
    note: z.string().trim().optional()
  })
});

export const processRefundSchema = z.object({
  body: z.object({ providerReference: z.string().min(2).optional() })
});

export const createRefundRequestSchema = z.object({
  body: z.object({
    saleId: z.string().min(1),
    originalInvoiceId: z.string().min(1).optional(),
    originalPaymentId: z.string().min(1).optional(),
    refundMethod: refundMethodSchema,
    refundType: refundTypeSchema.default("PARTIAL_ITEM"),
    reason: z.string().trim().min(3),
    detailedReason: z.string().trim().min(5),
    requestedAmount: z.number().positive().optional(),
    items: z.array(refundItemSchema).min(1)
  })
});

export const updateRefundRequestSchema = z.object({
  body: z.object({
    originalInvoiceId: z.string().min(1).optional().nullable(),
    originalPaymentId: z.string().min(1).optional().nullable(),
    refundMethod: refundMethodSchema,
    refundType: refundTypeSchema.default("PARTIAL_ITEM"),
    reason: z.string().trim().min(3),
    detailedReason: z.string().trim().min(5),
    requestedAmount: z.number().positive().optional(),
    items: z.array(refundItemSchema).min(1)
  })
});

export const submitRefundSchema = z.object({
  body: z.object({})
});

export const returnRefundForCorrectionSchema = z.object({
  body: z.object({
    instructions: z.string().trim().min(3)
  })
});

export const cancelRefundSchema = z.object({
  body: z.object({
    reason: z.string().trim().optional()
  })
});

export const initiateStkPushSchema = z.object({
  body: z.object({
    phoneNumber: z.string().min(10), // e.g. 254712345678
    amount: z.number().positive(),
    invoiceId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(128)
  })
});

export const reversePaymentSchema = z.object({
  body: z.object({
    reason: z.string().min(3)
  })
});

export const saveMpesaConfigSchema = z.object({
  body: z.object({
    environment: z.enum(["sandbox", "production"]).default("sandbox"),
    shortcode: z.string().min(1),
    consumerKey: z.string().min(1).optional(),
    consumerSecret: z.string().min(1).optional(),
    passkey: z.string().min(1).optional(),
    callbackUrl: z.string().url()
  })
});

export const resolveReconciliationSchema = z.object({
  body: z.object({
    reconciliationId: z.string().min(1),
    status: z.enum(["MATCHED", "MANUAL_RESOLVED"]),
    notes: z.string().min(3)
  })
});
