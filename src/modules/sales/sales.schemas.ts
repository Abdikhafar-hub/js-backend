import { z } from "zod";

export const createQuotationSchema = z.object({
  body: z.object({
    customerId: z.string().min(1),
    branchId: z.string().min(1),
    validUntil: z.string(),
    notes: z.string().optional(),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().positive(),
        discountAmount: z.number().nonnegative().default(0),
        taxAmount: z.number().nonnegative().default(0)
      })
    ).min(1)
  })
});

export const checkoutSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    customerId: z.string().optional().nullable(),
    priceListId: z.string().optional().nullable(),
    idempotencyKey: z.string().min(8).max(128),
    discountRequestId: z.string().optional().nullable(),
    saleType: z.enum(["RETAIL", "WHOLESALE", "CORPORATE", "INTERNAL"]).default("RETAIL"),
    notes: z.string().optional(),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        quantity: z.number().positive(),
        // Accepted for old clients, but checkout never trusts this value.
        unitPrice: z.number().positive().optional(),
        discountAmount: z.number().nonnegative().default(0),
        taxAmount: z.number().nonnegative().optional()
      })
    ).min(1),
    payments: z.array(
      z.object({
        paymentMethod: z.enum(["CASH", "MPESA", "CARD", "BANK_TRANSFER", "STORE_CREDIT", "CHEQUE", "OTHER"]),
        amount: z.number().positive(),
        reference: z.string().optional()
      })
    ).default([])
  })
});

export const createDiscountRequestSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    cartReference: z.string().min(8).max(128),
    requestedPercent: z.number().positive().max(100).optional(),
    requestedAmount: z.number().positive().optional(),
    reason: z.string().min(3)
  }).refine((value) => value.requestedPercent != null || value.requestedAmount != null, {
    message: "Requested percent or amount is required"
  })
});

export const rejectDiscountRequestSchema = z.object({
  body: z.object({ reason: z.string().min(3) })
});

export const quotePriceSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    customerId: z.string().optional().nullable(),
    priceListId: z.string().optional().nullable(),
    saleType: z.enum(["RETAIL", "WHOLESALE", "CORPORATE", "INTERNAL"]).default("RETAIL"),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        quantity: z.number().positive(),
        discountAmount: z.number().nonnegative().default(0),
        taxAmount: z.number().nonnegative().default(0)
      })
    ).min(1)
  })
});

export const suspendSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    customerId: z.string().optional().nullable(),
    priceListId: z.string().optional().nullable(),
    saleType: z.enum(["RETAIL", "WHOLESALE", "CORPORATE", "INTERNAL"]).default("RETAIL"),
    notes: z.string().optional().nullable(),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().positive().optional(),
        discountAmount: z.number().nonnegative().default(0),
        taxAmount: z.number().nonnegative().default(0)
      })
    ).min(1)
  })
});

export const cancelSaleSchema = z.object({
  body: z.object({
    reason: z.string().min(3)
  })
});

export const payInvoiceSchema = z.object({
  body: z.object({
    amount: z.number().positive(),
    paymentMethod: z.enum(["CASH", "MPESA", "CARD", "BANK_TRANSFER", "STORE_CREDIT", "CHEQUE", "OTHER"]),
    reference: z.string().optional()
  })
});

export const createInvoiceSchema = z.object({
  body: z.object({
    mode: z.enum(["DRAFT", "ISSUE"]).default("DRAFT"),
    invoiceType: z.enum(["STANDARD", "PRO_FORMA", "DEPOSIT", "FINAL", "WHOLESALE"]).default("STANDARD"),
    source: z.enum(["MANUAL", "SALES_ORDER", "QUOTATION_CONVERSION", "ONLINE_ORDER"]).default("MANUAL"),
    branchId: z.string().min(1),
    customerId: z.string().optional().nullable(),
    priceListId: z.string().optional().nullable(),
    saleType: z.enum(["RETAIL", "WHOLESALE", "CORPORATE", "INTERNAL"]).default("RETAIL"),
    issueDate: z.string(),
    dueDate: z.string(),
    paymentTermsDays: z.number().int().nonnegative().default(0),
    currencyCode: z.string().min(3).max(8).default("KES"),
    customerPurchaseOrderRef: z.string().optional().nullable(),
    externalReference: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    billingAddress: z.string().optional().nullable(),
    shippingAddress: z.string().optional().nullable(),
    deliveryMethod: z.string().optional().nullable(),
    contactPerson: z.string().optional().nullable(),
    expectedDeliveryDate: z.string().optional().nullable(),
    deliveryInstructions: z.string().optional().nullable(),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        quantity: z.number().positive(),
        discountAmount: z.number().nonnegative().default(0)
      })
    ).min(1)
  })
});
