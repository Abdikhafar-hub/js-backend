import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { customerAuthService } from "./customer-auth.service.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { prisma } from "../../lib/prisma.js";

const COOKIE_NAME = "customer_refresh_token";

const setRefreshTokenCookie = (res: Response, token: string) => {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
};

const clearRefreshTokenCookie = (res: Response) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });
};

const resolveOrganizationId = async (req: Request) => {
  const headerId = req.headers["x-organization-id"];

  if (typeof headerId === "string" && headerId.trim() !== "") {
    const organization = await prisma.organization.findUnique({
      where: { id: headerId },
      select: { id: true }
    });

    if (organization) {
      return organization.id;
    }
  }

  const firstOrganization = await prisma.organization.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" }
  });

  if (!firstOrganization) {
    return "default-org";
  }

  return firstOrganization.id;
};

export const customerAuthController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const organizationId = await resolveOrganizationId(req);
    
    const result = await customerAuthService.register(
      organizationId,
      {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        phone: req.body.phone,
        password: req.body.password
      },
      {
        ipAddress: req.ip,
        userAgent: req.header("user-agent")
      }
    );

    setRefreshTokenCookie(res, result.refreshToken);

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Registration successful",
      data: {
        accessToken: result.accessToken,
        account: result.account
      }
    });
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const organizationId = await resolveOrganizationId(req);

    const result = await customerAuthService.login(
      organizationId,
      {
        identifier: req.body.identifier,
        password: req.body.password
      },
      {
        ipAddress: req.ip,
        userAgent: req.header("user-agent")
      }
    );

    setRefreshTokenCookie(res, result.refreshToken);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Login successful",
      data: {
        accessToken: result.accessToken,
        account: result.account
      }
    });
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies[COOKIE_NAME] || req.body.refreshToken;

    if (!token) {
      res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: "Refresh token is missing"
      });
      return;
    }

    const result = await customerAuthService.refresh(token, {
      ipAddress: req.ip,
      userAgent: req.header("user-agent")
    });

    setRefreshTokenCookie(res, result.refreshToken);

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        accessToken: result.accessToken,
        account: result.account
      }
    });
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    if (req.customerAuth?.sessionId) {
      await customerAuthService.logout(req.customerAuth.sessionId);
    }
    clearRefreshTokenCookie(res);
    res.status(StatusCodes.OK).json({
      success: true,
      message: "Logged out successfully"
    });
  }),

  logoutAll: asyncHandler(async (req: Request, res: Response) => {
    if (req.customerAuth?.customerAccountId) {
      await customerAuthService.logoutAll(req.customerAuth.customerAccountId);
    }
    clearRefreshTokenCookie(res);
    res.status(StatusCodes.OK).json({
      success: true,
      message: "Logged out from all devices"
    });
  }),

  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    const organizationId = await resolveOrganizationId(req);

    const result = await customerAuthService.forgotPassword(organizationId, req.body.emailOrPhone);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "If the account exists, a reset token has been issued",
      data: result
    });
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    const organizationId = await resolveOrganizationId(req);

    await customerAuthService.resetPassword(organizationId, req.body.token, req.body.newPassword);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Password has been reset successfully"
    });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    if (!req.customerAuth) {
      res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: "Unauthenticated"
      });
      return;
    }

    const profile = await prisma.customerAccount.findUnique({
      where: { id: req.customerAuth.customerAccountId },
      include: { customer: true }
    });

    if (!profile) {
      res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: "Unauthenticated"
      });
      return;
    }

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        account: {
          id: profile.id,
          customerId: profile.customerId,
          firstName: profile.customer.firstName,
          lastName: profile.customer.lastName,
          email: profile.email,
          phone: profile.phoneNumber,
          status: profile.status
        }
      }
    });
  })
};
