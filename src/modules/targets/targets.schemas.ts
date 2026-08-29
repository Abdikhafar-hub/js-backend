import { z } from "zod";

export const createSalesTargetSchema = z.object({
  body: z.object({
    targetType: z.enum(["BRANCH", "USER"]),
    targetValue: z.number().positive(),
    startDate: z.string(),
    endDate: z.string(),
    branchId: z.string().optional(),
    userId: z.string().optional(),
    notes: z.string().optional()
  })
});
