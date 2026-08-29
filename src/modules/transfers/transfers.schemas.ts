import { z } from "zod";

export const createTransferSchema = z.object({
  body: z.object({
    sourceBranchId: z.string().min(1),
    destinationBranchId: z.string().min(1),
    requestReason: z.string().optional(),
    items: z.array(
      z.object({
        productVariantId: z.string().min(1),
        requestedQuantity: z.number().positive(),
        notes: z.string().optional()
      })
    ).min(1)
  })
});

export const approveTransferSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    items: z.array(
      z.object({
        itemId: z.string().min(1),
        approvedQuantity: z.number().nonnegative()
      })
    ).min(1)
  })
});

export const receiveTransferSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    items: z.array(
      z.object({
        itemId: z.string().min(1),
        receivedQuantity: z.number().nonnegative(),
        damagedQuantity: z.number().nonnegative().default(0),
        missingQuantity: z.number().nonnegative().default(0),
        batches: z.array(
          z.object({
            inventoryBatchId: z.string().min(1),
            receivedQuantity: z.number().nonnegative(),
            damagedQuantity: z.number().nonnegative().default(0),
            missingQuantity: z.number().nonnegative().default(0)
          })
        ).optional()
      })
    ).min(1)
  })
});
