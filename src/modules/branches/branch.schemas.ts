import { BranchStatus, BranchType } from "@prisma/client";
import { z } from "zod";

const optionalTrimmedString = z.string().trim().min(1).optional();

const createManagerSchema = z.object({
  mode: z.literal("CREATE_NEW"),
  firstName: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  phone: z.string().trim().min(7),
  email: z.string().trim().email(),
  password: z.string().min(8)
});

const assignExistingManagerSchema = z.object({
  mode: z.literal("ASSIGN_EXISTING"),
  userId: z.string().cuid(),
  confirmReassignment: z.boolean().optional()
});

export const branchManagerSchema = z.discriminatedUnion("mode", [
  createManagerSchema,
  assignExistingManagerSchema
]);

export const createBranchSchema = z.object({
  body: z.object({
    code: z.string().trim().min(2).max(20),
    name: z.string().trim().min(2),
    branchType: z.nativeEnum(BranchType),
    phone: z.string().trim().min(7).optional(),
    email: z.string().trim().email().optional(),
    address: optionalTrimmedString,
    city: optionalTrimmedString,
    county: optionalTrimmedString,
    isHeadOffice: z.boolean().optional(),
    isWarehouse: z.boolean().optional(),
    allowsNegativeStock: z.boolean().optional(),
    manager: branchManagerSchema.optional()
  })
});

export const updateBranchSchema = z.object({
  params: z.object({
    branchId: z.string().cuid()
  }),
  body: z.object({
    name: z.string().min(2).optional(),
    branchType: z.nativeEnum(BranchType).optional(),
    phone: z.string().min(7).optional().nullable(),
    email: z.string().email().optional().nullable(),
    address: z.string().min(2).optional().nullable(),
    city: z.string().min(2).optional().nullable(),
    county: z.string().min(2).optional().nullable(),
    allowsNegativeStock: z.boolean().optional(),
    status: z.nativeEnum(BranchStatus).optional()
  })
});

export const assignBranchManagerSchema = z.object({
  params: z.object({
    branchId: z.string().cuid()
  }),
  body: z.object({
    manager: branchManagerSchema
  })
});

export const branchIdSchema = z.object({
  params: z.object({
    branchId: z.string().cuid()
  })
});
