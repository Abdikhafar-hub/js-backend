import { z } from "zod";

export const redeemLoyaltyPointsSchema = z.object({
  body: z.object({
    customerId: z.string().min(1),
    branchId: z.string().min(1),
    points: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(128),
    notes: z.string().optional()
  })
});

export const adjustLoyaltyPointsSchema = z.object({
  body: z.object({
    customerId: z.string().min(1),
    points: z.number().int(), // can be positive or negative
    reason: z.string().min(3)
  })
});

export const saveLoyaltyProgramSchema = z.object({
  body: z.object({
    loyaltyEnabled: z.boolean(),
    earningRatio: z.number().positive().default(100), // e.g. 1 point per 100 KES
    redemptionRatio: z.number().positive().default(1) // e.g. 1 KES per 1 point
  })
});
