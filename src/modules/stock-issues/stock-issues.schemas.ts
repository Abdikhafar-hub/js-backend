import { z } from "zod";

const issueIdParams = z.object({
  params: z.object({
    id: z.string().min(1)
  })
});

export const createStockIssueSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    productVariantId: z.string().min(1),
    inventoryBatchId: z.string().min(1).optional(),
    quantity: z.number().positive(),
    issueType: z.enum(["DAMAGE", "LOSS", "EXPIRY", "FOUND_STOCK", "DATA_CORRECTION", "INTERNAL_USE", "SAMPLE", "TESTER", "OTHER"]),
    description: z.string().min(1),
    evidenceUrl: z.string().url().optional(),
    notes: z.string().optional()
  })
});

export const reviewStockIssueSchema = z.object({
  params: issueIdParams.shape.params,
  body: z.object({
    status: z.enum(["UNDER_REVIEW", "ACCEPTED"]),
    notes: z.string().optional()
  })
});

export const rejectStockIssueSchema = z.object({
  params: issueIdParams.shape.params,
  body: z.object({
    reason: z.string().min(1)
  })
});

export const convertStockIssueToAdjustmentSchema = z.object({
  params: issueIdParams.shape.params,
  body: z.object({
    notes: z.string().optional(),
    unitCost: z.number().nonnegative().optional()
  }).default({})
});
