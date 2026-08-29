import { UserRole, UserStatus } from "@prisma/client";
import { z } from "zod";

export const createUserSchema = z.object({
  body: z.object({
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(7).optional(),
    role: z.nativeEnum(UserRole),
    status: z.nativeEnum(UserStatus).optional(),
    temporaryPassword: z.string().min(8),
    branchIds: z.array(z.string().cuid()).min(1),
    primaryBranchId: z.string().cuid()
  })
});

export const updateUserSchema = z.object({
  params: z.object({
    userId: z.string().cuid()
  }),
  body: z.object({
    firstName: z.string().min(2).optional(),
    lastName: z.string().min(2).optional(),
    phone: z.string().min(7).optional().nullable(),
    role: z.nativeEnum(UserRole).optional(),
    status: z.nativeEnum(UserStatus).optional()
  })
});

export const userIdSchema = z.object({
  params: z.object({
    userId: z.string().cuid()
  })
});

export const assignBranchesSchema = z.object({
  params: z.object({
    userId: z.string().cuid()
  }),
  body: z.object({
    branchIds: z.array(z.string().cuid()).min(1),
    primaryBranchId: z.string().cuid()
  })
});

export const resetUserPasswordSchema = z.object({
  params: z.object({
    userId: z.string().cuid()
  }),
  body: z.object({
    temporaryPassword: z.string().min(8)
  })
});
