import { z } from "zod";
import { nullableMediaUrlSchema } from "../../utils/media-url-schema.js";

export const updateOrganizationSchema = z.object({
  body: z.object({
    legalName: z.string().min(2).optional(),
    tradingName: z.string().min(2).optional(),
    registrationNumber: z.string().min(2).optional().nullable(),
    taxNumber: z.string().min(2).optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().min(7).optional().nullable(),
    address: z.string().min(2).optional().nullable(),
    city: z.string().min(2).optional().nullable(),
    country: z.string().min(2).optional(),
    currencyCode: z.string().length(3).optional(),
    timezone: z.string().min(2).optional(),
    logoUrl: nullableMediaUrlSchema
  })
});

export const updateOrganizationSettingsSchema = z.object({
  body: z.object({
    defaultCurrency: z.string().length(3).optional(),
    timezone: z.string().min(2).optional(),
    taxEnabled: z.boolean().optional(),
    defaultTaxRate: z.number().min(0).max(100).optional(),
    negativeStockAllowed: z.boolean().optional(),
    saleRequiresOpenShift: z.boolean().optional(),
    maximumAttendantDiscount: z.number().min(0).max(100).optional(),
    maximumBranchManagerDiscount: z.number().min(0).max(100).optional(),
    maximumBranchManagerRefund: z.number().nonnegative().optional(),
    maximumBranchManagerExpense: z.number().nonnegative().optional(),
    loyaltyEnabled: z.boolean().optional(),
    wholesaleMinimumQuantity: z.number().positive().optional(),
    cashOnDeliveryEnabled: z.boolean().optional(),
    cashOnDeliveryMaximumOrderAmount: z.number().nonnegative().optional(),
    cashOnDeliveryAllowedZoneIds: z.array(z.string()).optional(),
    cashOnDeliveryRequiresConfirmation: z.boolean().optional()
  })
});
