import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    deviceId: z.string().min(2).max(128).optional(),
    deviceName: z.string().min(2).max(128).optional()
  })
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(20)
  })
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email()
  })
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(20),
    newPassword: z.string().min(8)
  })
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8)
  })
});

export const deleteSessionSchema = z.object({
  params: z.object({
    sessionId: z.string().uuid()
  })
});
