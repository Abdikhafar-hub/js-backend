import { z } from "zod";

export const goodsReceiptBootstrapSchema = z.object({
  params: z.object({
    purchaseOrderId: z.string().min(1)
  })
});

export const createGoodsReceiptSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    supplierId: z.string().min(1),
    purchaseOrderId: z.string().min(1),
    shipmentId: z.string().optional(),
    supplierInvoiceNumber: z.string().optional(),
    receivedAt: z.string().default(() => new Date().toISOString()),
    notes: z.string().optional(),
    items: z.array(
      z.object({
        purchaseOrderItemId: z.string().min(1),
        productVariantId: z.string().min(1),
        quantityExpected: z.number().positive(),
        quantityReceived: z.number().nonnegative(),
        quantityAccepted: z.number().nonnegative(),
        quantityRejected: z.number().nonnegative().default(0),
        rejectionReason: z.string().optional(),
        batchNumber: z.string().optional(),
        manufactureDate: z.string().optional(),
        expiryDate: z.string().optional(),
        unitCost: z.number().positive()
      }).superRefine((item, ctx) => {
        if (item.quantityAccepted + item.quantityRejected > item.quantityReceived) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Accepted plus rejected quantity cannot exceed received quantity"
          });
        }

        if (item.quantityRejected > 0 && !item.rejectionReason) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Rejection reason is required when rejected quantity is greater than zero"
          });
        }
      })
    ).min(1)
  })
});
