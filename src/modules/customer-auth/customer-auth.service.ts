import { CustomerAccountStatus, CustomerStatus, CustomerType, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { randomUUID } from "node:crypto";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { generateSecureToken, hashToken } from "../../lib/crypto.js";
import {
  signCustomerAccessToken,
  signCustomerRefreshToken,
  type CustomerTokenPayload
} from "../../lib/customer-jwt.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
import { normalizeEmail, normalizePhone } from "../../utils/normalize.js";

type RequestMetadata = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

// Default storefront customer settings helper
export async function getStorefrontSettings(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true }
  });

  const settings = (org?.settings as Record<string, any>) || {};

  return {
    registrationEnabled: settings.registrationEnabled !== false,
    emailRequired: !!settings.emailRequired,
    phoneRequired: settings.phoneRequired !== false,
    emailVerificationRequired: !!settings.emailVerificationRequired,
    phoneVerificationRequired: !!settings.phoneVerificationRequired,
    minimumPasswordLength: Number(settings.minimumPasswordLength) || 6,
    sessionDurationDays: Number(settings.sessionDurationDays) || 30,
    maxActiveSessions: Number(settings.maxActiveSessions) || 5,
    guestOrderLinkingWindowDays: Number(settings.guestOrderLinkingWindowDays) || 90,
    loyaltyEnabled: settings.loyaltyEnabled !== false,
    invoiceDownloadsEnabled: settings.invoiceDownloadsEnabled !== false,
    reorderEnabled: settings.reorderEnabled !== false
  };
}

export const customerAuthService = {
  async register(
    organizationId: string,
    input: {
      firstName: string;
      lastName: string;
      email?: string;
      phone: string;
      password: string;
    },
    metadata: RequestMetadata
  ) {
    const settings = await getStorefrontSettings(organizationId);

    if (!settings.registrationEnabled) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Registration is currently disabled", StatusCodes.FORBIDDEN);
    }

    if (input.password.length < settings.minimumPasswordLength) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `Password must be at least ${settings.minimumPasswordLength} characters long`,
        StatusCodes.BAD_REQUEST
      );
    }

    const normEmail = input.email ? normalizeEmail(input.email) : null;
    const normPhone = normalizePhone(input.phone);

    if (settings.emailRequired && !normEmail) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Email is required", StatusCodes.BAD_REQUEST);
    }

    if (settings.phoneRequired && !normPhone) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Phone number is required", StatusCodes.BAD_REQUEST);
    }

    // Check for existing CustomerAccount
    const existingAccount = await prisma.customerAccount.findFirst({
      where: {
        organizationId,
        OR: [
          normEmail ? { normalizedEmail: normEmail } : undefined,
          normPhone ? { normalizedPhoneNumber: normPhone } : undefined
        ].filter(Boolean) as Prisma.CustomerAccountWhereInput[]
      }
    });

    if (existingAccount) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "An account with this email or phone number already exists",
        StatusCodes.CONFLICT
      );
    }

    // Hash password
    const passwordHash = await hashPassword(input.password);

    return prisma.$transaction(async (tx) => {
      // Find existing Customer by verified phone or email
      let customer = await tx.customer.findFirst({
        where: {
          organizationId,
          status: CustomerStatus.ACTIVE,
          OR: [
            normPhone ? { phone: normPhone } : undefined,
            normEmail ? { email: normEmail } : undefined
          ].filter(Boolean) as Prisma.CustomerWhereInput[]
        }
      });

      if (!customer) {
        // Create new Customer
        const count = await tx.customer.count({ where: { organizationId } });
        customer = await tx.customer.create({
          data: {
            organizationId,
            customerNumber: `CUST-${String(count + 1).padStart(6, "0")}`,
            customerType: CustomerType.RETAIL,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: normPhone,
            email: normEmail,
            status: CustomerStatus.ACTIVE
          }
        });
      }

      // Create CustomerAccount
      const account = await tx.customerAccount.create({
        data: {
          organizationId,
          customerId: customer.id,
          email: input.email || null,
          normalizedEmail: normEmail,
          phoneNumber: input.phone,
          normalizedPhoneNumber: normPhone,
          passwordHash,
          status: CustomerAccountStatus.ACTIVE
        }
      });

      // Issue first session
      const sessionId = randomUUID();
      const payload: CustomerTokenPayload = {
        customerAccountId: account.id,
        customerId: customer.id,
        organizationId,
        sessionId,
        tokenVersion: account.tokenVersion
      };

      const accessToken = signCustomerAccessToken(payload);
      const refreshToken = signCustomerRefreshToken(payload);

      await tx.customerSession.create({
        data: {
          id: sessionId,
          customerAccountId: account.id,
          refreshTokenHash: hashToken(refreshToken),
          userAgent: metadata.userAgent || null,
          ipAddressHash: metadata.ipAddress ? hashToken(metadata.ipAddress) : null,
          expiresAt: new Date(Date.now() + settings.sessionDurationDays * 24 * 60 * 60 * 1000)
        }
      });

      return {
        accessToken,
        refreshToken,
        account: {
          id: account.id,
          customerId: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: account.email,
          phone: account.phoneNumber,
          status: account.status
        }
      };
    });
  },

  async login(
    organizationId: string,
    input: {
      identifier: string;
      password: string;
    },
    metadata: RequestMetadata
  ) {
    const settings = await getStorefrontSettings(organizationId);
    const normIdentifier = input.identifier.trim().toLowerCase();
    const normPhone = normalizePhone(input.identifier);

    const account = await prisma.customerAccount.findFirst({
      where: {
        organizationId,
        OR: [
          { normalizedEmail: normIdentifier },
          { normalizedPhoneNumber: normPhone }
        ]
      },
      include: {
        customer: true
      }
    });

    if (!account) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Invalid credentials", StatusCodes.UNAUTHORIZED);
    }

    if (account.status !== CustomerAccountStatus.ACTIVE) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, `Account status is ${account.status}`, StatusCodes.FORBIDDEN);
    }

    const matches = await verifyPassword(input.password, account.passwordHash);
    if (!matches) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Invalid credentials", StatusCodes.UNAUTHORIZED);
    }

    // Issue session
    const sessionId = randomUUID();
    const payload: CustomerTokenPayload = {
      customerAccountId: account.id,
      customerId: account.customerId,
      organizationId,
      sessionId,
      tokenVersion: account.tokenVersion
    };

    const accessToken = signCustomerAccessToken(payload);
    const refreshToken = signCustomerRefreshToken(payload);

    await prisma.$transaction([
      prisma.customerAccount.update({
        where: { id: account.id },
        data: { lastLoginAt: new Date() }
      }),
      prisma.customerSession.create({
        data: {
          id: sessionId,
          customerAccountId: account.id,
          refreshTokenHash: hashToken(refreshToken),
          userAgent: metadata.userAgent || null,
          ipAddressHash: metadata.ipAddress ? hashToken(metadata.ipAddress) : null,
          expiresAt: new Date(Date.now() + settings.sessionDurationDays * 24 * 60 * 60 * 1000)
        }
      })
    ]);

    return {
      accessToken,
      refreshToken,
      account: {
        id: account.id,
        customerId: account.customerId,
        firstName: account.customer.firstName,
        lastName: account.customer.lastName,
        email: account.email,
        phone: account.phoneNumber,
        status: account.status
      }
    };
  },

  async refresh(refreshToken: string, metadata: RequestMetadata) {
    const payload = signCustomerRefreshToken ? (await prisma.$transaction(async (tx) => {
      // Decode inside transaction
      let decoded: CustomerTokenPayload;
      try {
        const jwt = await import("../../lib/customer-jwt.js");
        decoded = jwt.verifyCustomerRefreshToken(refreshToken);
      } catch (err) {
        throw new AppError(ERROR_CODES.TOKEN_INVALID, "Invalid refresh token", StatusCodes.UNAUTHORIZED);
      }

      const hash = hashToken(refreshToken);
      const session = await tx.customerSession.findUnique({
        where: { refreshTokenHash: hash },
        include: { customerAccount: { include: { customer: true } } }
      });

      if (!session) {
        throw new AppError(ERROR_CODES.TOKEN_INVALID, "Session not found", StatusCodes.UNAUTHORIZED);
      }

      if (session.revokedAt || session.expiresAt < new Date()) {
        // Revoke all sibling sessions (reuse detection)
        await tx.customerSession.updateMany({
          where: { customerAccountId: session.customerAccountId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "REUSE_DETECTED" }
        });
        throw new AppError(ERROR_CODES.TOKEN_REUSED, "Session has been revoked", StatusCodes.UNAUTHORIZED);
      }

      const account = session.customerAccount;
      if (account.tokenVersion !== decoded.tokenVersion || account.status !== CustomerAccountStatus.ACTIVE) {
        throw new AppError(ERROR_CODES.TOKEN_INVALID, "Account status changed", StatusCodes.UNAUTHORIZED);
      }

      // Rotate session
      const settings = await getStorefrontSettings(decoded.organizationId);
      const nextSessionId = randomUUID();
      const nextPayload: CustomerTokenPayload = {
        customerAccountId: account.id,
        customerId: account.customerId,
        organizationId: decoded.organizationId,
        sessionId: nextSessionId,
        tokenVersion: account.tokenVersion
      };

      const nextAccessToken = signCustomerAccessToken(nextPayload);
      const nextRefreshToken = signCustomerRefreshToken(nextPayload);

      // Revoke current session
      await tx.customerSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokeReason: "ROTATED" }
      });

      // Create new session
      await tx.customerSession.create({
        data: {
          id: nextSessionId,
          customerAccountId: account.id,
          refreshTokenHash: hashToken(nextRefreshToken),
          userAgent: metadata.userAgent || null,
          ipAddressHash: metadata.ipAddress ? hashToken(metadata.ipAddress) : null,
          expiresAt: new Date(Date.now() + settings.sessionDurationDays * 24 * 60 * 60 * 1000)
        }
      });

      return {
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
        account: {
          id: account.id,
          customerId: account.customerId,
          firstName: account.customer.firstName,
          lastName: account.customer.lastName,
          email: account.email,
          phone: account.phoneNumber,
          status: account.status
        }
      };
    })) : null;

    if (!payload) throw new AppError(ERROR_CODES.TOKEN_INVALID, "Invalid session rotation configuration", StatusCodes.UNAUTHORIZED);
    return payload;
  },

  async logout(sessionId: string) {
    await prisma.customerSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "LOGOUT" }
    });
  },

  async logoutAll(customerAccountId: string) {
    await prisma.customerSession.updateMany({
      where: { customerAccountId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "LOGOUT_ALL" }
    });
  },

  async forgotPassword(organizationId: string, emailOrPhone: string) {
    const normIdentifier = emailOrPhone.trim().toLowerCase();
    const normPhone = normalizePhone(emailOrPhone);

    const account = await prisma.customerAccount.findFirst({
      where: {
        organizationId,
        OR: [
          { normalizedEmail: normIdentifier },
          { normalizedPhoneNumber: normPhone }
        ]
      }
    });

    if (!account) {
      // Return success silently so we do not leak if accounts exist or not
      return { success: true };
    }

    const token = generateSecureToken();
    const tokenHash = hashToken(token);

    await prisma.customerPasswordResetToken.create({
      data: {
        organizationId,
        customerAccountId: account.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      }
    });

    return {
      success: true,
      resetToken: process.env.NODE_ENV === "production" ? undefined : token
    };
  },

  async resetPassword(organizationId: string, token: string, newPassword: string) {
    const tokenHash = hashToken(token);
    const resetRecord = await prisma.customerPasswordResetToken.findFirst({
      where: {
        organizationId,
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() }
      },
      include: { customerAccount: true }
    });

    if (!resetRecord) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, "Password reset token is invalid or expired", StatusCodes.BAD_REQUEST);
    }

    const newHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      // Update password and increment tokenVersion to revoke previous sessions
      await tx.customerAccount.update({
        where: { id: resetRecord.customerAccountId },
        data: {
          passwordHash: newHash,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 }
        }
      });

      // Mark token as used
      await tx.customerPasswordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() }
      });

      // Revoke all active sessions
      await tx.customerSession.updateMany({
        where: { customerAccountId: resetRecord.customerAccountId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "PASSWORD_RESET" }
      });
    });
  }
};
