import { z } from "zod";
import { CustomerType, CustomerStatus } from "@prisma/client";

export const createCustomerSchema = z.object({
  body: z.object({
    customerType: z.nativeEnum(CustomerType),
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    businessName: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    alternatePhone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal("")),
    taxNumber: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    county: z.string().optional().nullable(),
    preferredBranchId: z.string().optional().nullable(),
    creditAllowed: z.boolean().default(false),
    creditLimit: z.number().nonnegative().default(0),
    paymentTermsDays: z.number().int().nonnegative().default(0),
    notes: z.string().optional().nullable(),
    status: z.nativeEnum(CustomerStatus).default(CustomerStatus.ACTIVE)
  })
});

export const updateCustomerSchema = z.object({
  body: z.object({
    customerType: z.nativeEnum(CustomerType).optional(),
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    businessName: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    alternatePhone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal("")),
    taxNumber: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    county: z.string().optional().nullable(),
    preferredBranchId: z.string().optional().nullable(),
    creditAllowed: z.boolean().optional(),
    creditLimit: z.number().nonnegative().optional(),
    paymentTermsDays: z.number().int().nonnegative().optional(),
    notes: z.string().optional().nullable(),
    status: z.nativeEnum(CustomerStatus).optional()
  })
});

export const updateCustomerCreditSchema = z.object({
  body: z.object({
    creditAllowed: z.boolean(),
    creditLimit: z.number().nonnegative(),
    paymentTermsDays: z.number().int().nonnegative()
  })
});
