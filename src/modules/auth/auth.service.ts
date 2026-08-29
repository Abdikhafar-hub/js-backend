import { UserStatus, type Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { randomUUID } from "node:crypto";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { generateSecureToken, hashToken } from "../../lib/crypto.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type AccessTokenPayload
} from "../../lib/jwt.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
import { auditService } from "../../services/audit.service.js";
import { env } from "../../config/env.js";

import type { AuthContext } from "../../types/auth.js";
import { rolePermissions } from "../../policies/role-permissions.js";

type RequestMetadata = {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const buildTokenPayload = (input: {
  userId: string;
  organizationId: string;
  role: string;
  sessionId: string;
  tokenVersion: number;
}): AccessTokenPayload => ({
  sub: input.userId,
  organizationId: input.organizationId,
  role: input.role,
  sessionId: input.sessionId,
  tokenVersion: input.tokenVersion
});

const issueSessionTokens = async (
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    organizationId: string;
    role: string;
    tokenVersion: number;
    deviceId?: string;
    deviceName?: string;
  },
  metadata: RequestMetadata,
  familyId: string = randomUUID()
) => {
  const sessionId = randomUUID();
  const payload = buildTokenPayload({
    userId: input.userId,
    organizationId: input.organizationId,
    role: input.role,
    sessionId,
    tokenVersion: input.tokenVersion
  });
  const refreshToken = signRefreshToken(payload);
  const accessToken = signAccessToken(payload);

  await tx.refreshToken.create({
    data: {
      id: sessionId,
      familyId,
      organizationId: input.organizationId,
      userId: input.userId,
      tokenHash: hashToken(refreshToken),
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });

  return {
    accessToken,
    refreshToken,
    sessionId
  };
};

const revokeFamily = async (tx: Prisma.TransactionClient, familyId: string, reason: string) => {
  await tx.refreshToken.updateMany({
    where: {
      familyId,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });

  const tokenOwner = await tx.refreshToken.findFirst({
    where: { familyId },
    select: {
      organizationId: true,
      userId: true
    }
  });

  if (tokenOwner) {
    await tx.securityEvent.create({
      data: {
        organizationId: tokenOwner.organizationId,
        userId: tokenOwner.userId,
        type: "TOKEN_REUSED",
        metadata: { reason }
      }
    });
  }
};

export const authService = {
  async login(
    input: {
      email: string;
      password: string;
      deviceId?: string;
      deviceName?: string;
    },
    metadata: RequestMetadata
  ) {
    const user = await prisma.user.findFirst({
      where: {
        email: input.email.trim().toLowerCase()
      },
      include: {
        branchAssignments: {
          where: {
            activeUntil: null
          },
          include: {
            branch: true
          }
        }
      }
    });

    if (!user) {
      await prisma.loginAttempt.create({
        data: {
          organizationId: null,
          email: input.email,
          success: false,
          failureReason: "USER_NOT_FOUND",
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        }
      });

      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Invalid credentials", StatusCodes.UNAUTHORIZED);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Account is locked", StatusCodes.FORBIDDEN);
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);

    if (!passwordMatches) {
      const nextFailedAttempts = user.failedLoginAttempts + 1;
      const shouldLock = nextFailedAttempts >= MAX_FAILED_ATTEMPTS;

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: nextFailedAttempts,
            lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null
          }
        }),
        prisma.loginAttempt.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            email: input.email,
            success: false,
            failureReason: "INVALID_PASSWORD",
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent
          }
        }),
        prisma.securityEvent.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            type: shouldLock ? "ACCOUNT_LOCKED" : "LOGIN_FAILURE",
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent
          }
        })
      ]);

      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Invalid credentials", StatusCodes.UNAUTHORIZED);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError(ERROR_CODES.USER_SUSPENDED, "User is not active", StatusCodes.FORBIDDEN);
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          lastLoginIp: metadata.ipAddress
        }
      });

      await tx.loginAttempt.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          email: input.email,
          success: true,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        }
      });

      await tx.securityEvent.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          type: "LOGIN_SUCCESS",
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        }
      });

      const tokens = await issueSessionTokens(
        tx,
        {
          userId: user.id,
          organizationId: user.organizationId,
          role: user.role,
          tokenVersion: user.tokenVersion,
          deviceId: input.deviceId,
          deviceName: input.deviceName
        },
        metadata
      );

      await auditService.create({
        organizationId: user.organizationId,
        userId: user.id,
        action: "auth.login",
        entityType: "User",
        entityId: user.id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        metadata: {
          sessionId: tokens.sessionId
        }
      });

      return tokens;
    });

    return {
      ...result,
      user: {
        id: user.id,
        organizationId: user.organizationId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        branches: user.branchAssignments.map((assignment) => ({
          id: assignment.branch.id,
          code: assignment.branch.code,
          name: assignment.branch.name,
          isPrimary: assignment.isPrimary
        }))
      }
    };
  },

  async refresh(refreshToken: string, metadata: RequestMetadata) {
    const payload = verifyRefreshToken(refreshToken);
    const refreshTokenHash = hashToken(refreshToken);

    return prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findFirst({
        where: {
          id: payload.sessionId,
          organizationId: payload.organizationId
        },
        include: {
          user: true
        }
      });

      if (!existing || existing.tokenHash !== refreshTokenHash) {
        if (existing) {
          await revokeFamily(tx, existing.familyId, "hash_mismatch");
        }

        throw new AppError(ERROR_CODES.TOKEN_INVALID, "Refresh token is invalid", StatusCodes.UNAUTHORIZED);
      }

      if (existing.revokedAt || existing.expiresAt < new Date()) {
        await revokeFamily(tx, existing.familyId, "reused_or_expired");
        throw new AppError(ERROR_CODES.TOKEN_REUSED, "Refresh token has been revoked", StatusCodes.UNAUTHORIZED);
      }

      if (existing.user.tokenVersion !== payload.tokenVersion || existing.user.status !== UserStatus.ACTIVE) {
        throw new AppError(ERROR_CODES.TOKEN_INVALID, "Refresh token is no longer valid", StatusCodes.UNAUTHORIZED);
      }

      const nextSession = await issueSessionTokens(
        tx,
        {
          userId: existing.userId,
          organizationId: existing.organizationId,
          role: existing.user.role,
          tokenVersion: existing.user.tokenVersion,
          deviceId: existing.deviceId ?? undefined,
          deviceName: existing.deviceName ?? undefined
        },
        metadata,
        existing.familyId
      );

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenId: nextSession.sessionId
        }
      });

      return nextSession;
    });
  },

  async logout(auth: AuthContext) {
    await prisma.refreshToken.updateMany({
      where: {
        id: auth.sessionId,
        userId: auth.userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  },

  async logoutAll(auth: AuthContext) {
    await prisma.refreshToken.updateMany({
      where: {
        userId: auth.userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  },

  async forgotPassword(input: { email: string }) {
    const user = await prisma.user.findFirst({
      where: {
        email: input.email.trim().toLowerCase()
      }
    });

    if (!user) {
      return { issued: false };
    }

    const token = generateSecureToken();
    await prisma.$transaction([
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        }
      }),
      prisma.securityEvent.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          type: "PASSWORD_RESET_REQUESTED"
        }
      })
    ]);

    return {
      issued: true,
      resetToken: env.NODE_ENV === "production" ? undefined : token
    };
  },

  async resetPassword(input: { token: string; newPassword: string }) {
    const tokenHash = hashToken(input.token);
    const record = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: {
          gt: new Date()
        }
      },
      include: {
        user: true
      }
    });

    if (!record) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, "Password reset token is invalid", StatusCodes.UNAUTHORIZED);
    }

    const nextPasswordHash = await hashPassword(input.newPassword);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: nextPasswordHash,
          passwordChangedAt: new Date(),
          tokenVersion: {
            increment: 1
          },
          mustChangePassword: false
        }
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: {
          usedAt: new Date()
        }
      }),
      prisma.refreshToken.updateMany({
        where: {
          userId: record.userId,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      }),
      prisma.securityEvent.create({
        data: {
          organizationId: record.user.organizationId,
          userId: record.userId,
          type: "PASSWORD_CHANGED"
        }
      })
    ]);
  },

  async changePassword(
    auth: AuthContext,
    input: { currentPassword: string; newPassword: string }
  ) {
    const user = await prisma.user.findFirst({
      where: {
        id: auth.userId,
        organizationId: auth.organizationId
      }
    });

    if (!user) {
      throw new AppError(ERROR_CODES.AUTHENTICATION_REQUIRED, "User not found", StatusCodes.UNAUTHORIZED);
    }

    const valid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!valid) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Current password is incorrect", StatusCodes.UNAUTHORIZED);
    }

    const nextPasswordHash = await hashPassword(input.newPassword);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: nextPasswordHash,
          passwordChangedAt: new Date(),
          tokenVersion: {
            increment: 1
          },
          mustChangePassword: false
        }
      }),
      prisma.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      }),
      prisma.securityEvent.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          type: "PASSWORD_CHANGED"
        }
      })
    ]);
  },

  async me(auth: AuthContext) {
    const user = await prisma.user.findFirst({
      where: {
        id: auth.userId,
        organizationId: auth.organizationId
      },
      select: {
        id: true,
        organizationId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        branchAssignments: {
          where: {
            activeUntil: null
          },
          include: {
            branch: true
          }
        }
      }
    });

    return user ? { ...user, permissions: rolePermissions[user.role] } : null;
  },

  async listSessions(auth: AuthContext) {
    return prisma.refreshToken.findMany({
      where: {
        userId: auth.userId
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        ipAddress: true,
        userAgent: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true
      }
    });
  },

  async revokeSession(auth: AuthContext, sessionId: string) {
    const session = await prisma.refreshToken.findFirst({
      where: {
        id: sessionId,
        userId: auth.userId
      }
    });

    if (!session) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Session not found", StatusCodes.NOT_FOUND);
    }

    await prisma.refreshToken.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date()
      }
    });
  }
};
