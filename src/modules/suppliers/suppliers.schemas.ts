import { z } from "zod";

export const createSupplierSchema = z.object({
  body: z.object({
    code: z.string().min(1).max(50),
    name: z.string().min(1).max(255),
    legalName: z.string().min(1).max(255),
    contactPerson: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional(),
    alternatePhone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional().default("Kenya"),
    taxNumber: z.string().optional(),
    paymentTermsDays: z.number().int().nonnegative().default(0),
    currencyCode: z.string().min(3).max(3).default("KES"),
    creditLimit: z.number().nonnegative().optional(),
    notes: z.string().optional()
  })
});

export const updateSupplierSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: createSupplierSchema.shape.body.partial()
});

export const addSupplierContactSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    name: z.string().min(1),
    role: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional(),
    isPrimary: z.boolean().default(false)
  })
});

export const recordSupplierPaymentSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    paymentMethod: z.enum(["CASH", "MPESA", "CARD", "BANK_TRANSFER", "STORE_CREDIT", "CHEQUE", "OTHER"]),
    amount: z.number().positive(),
    currencyCode: z.string().min(3).max(3).default("KES"),
    exchangeRate: z.number().positive().default(1.0),
    reference: z.string().optional(),
    notes: z.string().optional()
  })
});
