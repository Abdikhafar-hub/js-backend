import { z } from "zod";

export const createRequisitionSchema = z.object({
  body: z.object({
    requestingBranchId: z.string().min(1),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    reason: z.string().optional(),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        quantityRequested: z.number().positive(),
        notes: z.string().optional()
      })
    ).min(1)
  })
});

export const updateRequisitionSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: createRequisitionSchema.shape.body.partial()
});

export const approveRequisitionSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    items: z.array(
      z.object({
        itemId: z.string().min(1),
        quantityApproved: z.number().nonnegative()
      })
    ).min(1),
    notes: z.string().optional()
  })
});

export const rejectRequisitionSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    reason: z.string().min(1)
  })
});

export const createPOSchema = z.object({
  body: z.object({
    supplierId: z.string().min(1),
    destinationBranchId: z.string().min(1),
    sourceRequisitionId: z.string().optional(),
    currencyCode: z.string().min(3).max(3).default("KES"),
    exchangeRate: z.number().positive().default(1.0),
    discountAmount: z.number().nonnegative().default(0),
    taxAmount: z.number().nonnegative().default(0),
    paymentTermsDays: z.number().int().nonnegative().default(0),
    expectedDeliveryDate: z.string().optional(),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        quantityOrdered: z.number().positive(),
        unitCost: z.number().positive(),
        discountAmount: z.number().nonnegative().default(0),
        taxAmount: z.number().nonnegative().default(0),
        notes: z.string().optional()
      })
    ).min(1)
  })
});

export const convertRequisitionToPOSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    supplierId: z.string().min(1),
    destinationBranchId: z.string().min(1),
    currencyCode: z.string().min(3).max(3).default("KES"),
    exchangeRate: z.number().positive().default(1.0),
    discountAmount: z.number().nonnegative().default(0),
    taxAmount: z.number().nonnegative().default(0),
    paymentTermsDays: z.number().int().nonnegative().default(0),
    expectedDeliveryDate: z.string().optional(),
    items: z
      .array(
        z.object({
          itemId: z.string().min(1),
          unitCost: z.number().positive(),
          discountAmount: z.number().nonnegative().default(0),
          taxAmount: z.number().nonnegative().default(0),
          notes: z.string().optional()
        })
      )
      .min(1)
  })
});

export const approvePOSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    notes: z.string().optional()
  })
});
