import { z } from "zod";

export const startShiftSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    openingFloat: z.number().nonnegative()
  })
});

export const recordShiftCashSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    movementType: z.enum(["CASH_IN", "CASH_OUT", "BANKING", "ADJUSTMENT"]),
    amount: z.number().positive(),
    reason: z.string().min(1),
    reference: z.string().optional(),
    notes: z.string().optional()
  })
});

export const endShiftSchema = z.object({
  params: z.object({
    id: z.string().min(1)
  }),
  body: z.object({
    declaredCash: z.number().nonnegative(),
    notes: z.string().optional()
  })
});

export const clockInSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    notes: z.string().optional()
  })
});

export const createExpenseSchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    categoryId: z.string().min(1),
    description: z.string().min(1),
    amount: z.number().positive(),
    paymentMethod: z.enum(["CASH", "MPESA", "CARD", "BANK_TRANSFER", "STORE_CREDIT", "CHEQUE", "OTHER"]),
    notes: z.string().optional(),
    shiftId: z.string().optional()
  })
});

export const createExpenseCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1),
    description: z.string().optional()
  })
});

export const rejectExpenseSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    reason: z.string().min(1)
  })
});

export const payExpenseSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ providerReference: z.string().min(2).optional() })
});

export const reconcileDailySchema = z.object({
  body: z.object({
    branchId: z.string().min(1),
    date: z.string(),
    declaredCash: z.number().nonnegative(),
    notes: z.string().optional()
  })
});

export const approveReconciliationSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    notes: z.string().optional()
  })
});
