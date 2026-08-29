import { z } from "zod";

export const createStockCountSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    countType: z.enum(["FULL", "CYCLE", "SPOT", "CATEGORY", "BRAND"]),
    blindCount: z.boolean().default(false),
    notes: z.string().optional().nullable(),
    scheduledAt: z.string().optional().nullable(),
    assignedUserIds: z.array(z.string()).optional(),
    categoryId: z.string().optional().nullable(),
    brandId: z.string().optional().nullable(),
    productVariantIds: z.array(z.string()).optional()
  })
});

export const updateStockCountItemsSchema = z.object({
  body: z.object({
    items: z.array(
      z.object({
        id: z.string().min(1),
        countedQuantity: z.number().nonnegative().nullable().optional(),
        notes: z.string().optional().nullable(),
        status: z.enum(["UNCOUNTED", "COUNTED", "RECOUNT_REQUIRED"]).optional()
      })
    ).min(1)
  })
});

export const requestRecountSchema = z.object({
  body: z.object({
    itemIds: z.array(z.string()).min(1)
  })
});

export const postStockCountSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  })
});
