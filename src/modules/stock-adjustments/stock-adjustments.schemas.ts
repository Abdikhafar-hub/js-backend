import { z } from "zod";

const adjustmentIdParams = z.object({
  params: z.object({
    id: z.string().min(1)
  })
});

export const createStockAdjustmentSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    adjustmentType: z.enum([
      "DAMAGE",
      "LOSS",
      "EXPIRY",
      "FOUND_STOCK",
      "DATA_CORRECTION",
      "INTERNAL_USE",
      "SAMPLE_USAGE",
      "TESTER_USAGE",
      "OTHER"
    ]),
    reason: z.string().min(1),
    notes: z.string().optional(),
    sourceStockIssueId: z.string().optional(),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        inventoryBatchId: z.string().optional().nullable(),
        direction: z.enum(["INCREASE", "DECREASE"]),
        quantity: z.number().positive(),
        unitCost: z.number().nonnegative().optional(),
        notes: z.string().optional()
      })
    ).min(1)
  })
}).superRefine((val, ctx) => {
  const seen = new Set<string>();
  val.body.items.forEach((item, idx) => {
    const key = `${item.productVariantId}:${item.inventoryBatchId || ""}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate adjustment lines are not allowed. Please consolidate quantities.",
        path: ["body", "items", idx, "productVariantId"]
      });
    }
    seen.add(key);
  });
});

export const submitStockAdjustmentSchema = adjustmentIdParams;

export const approveStockAdjustmentSchema = z.object({
  params: adjustmentIdParams.shape.params,
  body: z.object({
    notes: z.string().optional()
  }).default({})
});

export const rejectStockAdjustmentSchema = z.object({
  params: adjustmentIdParams.shape.params,
  body: z.object({
    reason: z.string().min(1)
  })
});

export const postStockAdjustmentSchema = adjustmentIdParams;

export const cancelStockAdjustmentSchema = z.object({
  params: adjustmentIdParams.shape.params,
  body: z.object({
    reason: z.string().optional()
  }).default({})
});
