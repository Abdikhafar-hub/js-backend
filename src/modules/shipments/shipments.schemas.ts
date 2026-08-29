import { z } from "zod";

export const createShipmentSchema = z.object({
  body: z.object({
    supplierId: z.string().min(1),
    purchaseOrderId: z.string().min(1),
    shippingMethod: z.string().optional(),
    originCountry: z.string().optional(),
    destinationCountry: z.string().optional(),
    carrier: z.string().optional(),
    trackingNumber: z.string().optional(),
    containerNumber: z.string().optional(),
    billOfLadingNumber: z.string().optional(),
    departureDate: z.string().optional(),
    expectedArrivalDate: z.string().optional(),
    actualArrivalDate: z.string().optional(),
    customsClearanceDate: z.string().optional(),
    currencyCode: z.string().min(3).max(3).default("KES"),
    exchangeRate: z.number().positive().default(1.0),
    notes: z.string().optional()
  })
});

export const addShipmentCostSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    costType: z.string().min(1),
    amount: z.number().positive(),
    currencyCode: z.string().min(3).max(3).default("KES"),
    exchangeRate: z.number().positive().default(1.0),
    allocationMethod: z.enum(["BY_QUANTITY", "BY_PURCHASE_VALUE", "BY_WEIGHT", "MANUAL"])
      .default("BY_QUANTITY"),
    reference: z.string().optional(),
    notes: z.string().optional()
  })
});

export const updateShipmentStatusSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    status: z.enum([
      "PLANNED",
      "BOOKED",
      "IN_TRANSIT",
      "ARRIVED",
      "UNDER_CUSTOMS_CLEARANCE",
      "CLEARED",
      "RECEIVED",
      "CANCELLED"
    ])
  })
});
