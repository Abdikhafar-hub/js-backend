import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { storefrontAccountService } from "./storefront-account.service.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/password.js";

export const storefrontAccountController = {
  getProfile: asyncHandler(async (req: Request, res: Response) => {
    const customerAccountId = req.customerAuth!.customerAccountId;
    const profile = await storefrontAccountService.getProfile(customerAccountId);

    res.status(StatusCodes.OK).json({
      success: true,
      data: profile
    });
  }),

  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    const customerAccountId = req.customerAuth!.customerAccountId;
    const organizationId = req.customerAuth!.organizationId;

    const profile = await storefrontAccountService.updateProfile(customerAccountId, organizationId, {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phone: req.body.phone
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Profile updated successfully",
      data: profile
    });
  }),

  listAddresses: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const addresses = await storefrontAccountService.listAddresses(customerId);

    res.status(StatusCodes.OK).json({
      success: true,
      data: addresses
    });
  }),

  createAddress: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;

    const address = await storefrontAccountService.createAddress(customerId, {
      addressLine1: req.body.addressLine1 as string,
      addressLine2: (req.body.addressLine2 || null) as string | null,
      city: req.body.city as string,
      county: (req.body.county || null) as string | null,
      country: (req.body.country || undefined) as string | undefined,
      isPrimaryShipping: !!req.body.isPrimaryShipping,
      isPrimaryBilling: !!req.body.isPrimaryBilling
    });

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Address created successfully",
      data: address
    });
  }),

  updateAddress: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const addressId = req.params.id as string;

    const address = await storefrontAccountService.updateAddress(customerId, addressId, {
      addressLine1: req.body.addressLine1 as string,
      addressLine2: (req.body.addressLine2 || null) as string | null,
      city: req.body.city as string,
      county: (req.body.county || null) as string | null,
      country: (req.body.country || undefined) as string | undefined,
      isPrimaryShipping: !!req.body.isPrimaryShipping,
      isPrimaryBilling: !!req.body.isPrimaryBilling
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Address updated successfully",
      data: address
    });
  }),

  deleteAddress: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const addressId = req.params.id as string;

    await storefrontAccountService.deleteAddress(customerId, addressId);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Address deleted successfully"
    });
  }),

  setDefaultAddress: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const addressId = req.params.id as string;

    await storefrontAccountService.setDefaultAddress(customerId, addressId);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Default address updated successfully"
    });
  }),

  listOrders: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const organizationId = req.customerAuth!.organizationId;

    const orders = await storefrontAccountService.listOrders(customerId, organizationId, {
      page: req.query.page as string,
      limit: req.query.limit as string,
      status: req.query.status as string
    });

    res.status(StatusCodes.OK).json({
      success: true,
      data: orders
    });
  }),

  getOrderDetails: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const organizationId = req.customerAuth!.organizationId;
    const orderNumber = req.params.orderNumber as string;

    const order = await storefrontAccountService.getOrderDetails(customerId, organizationId, orderNumber);

    res.status(StatusCodes.OK).json({
      success: true,
      data: order
    });
  }),

  linkGuestOrders: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const organizationId = req.customerAuth!.organizationId;

    const result = await storefrontAccountService.linkGuestOrders(
      customerId,
      organizationId,
      req.body.phone,
      req.body.email
    );

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Guest orders linked successfully",
      data: result
    });
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const organizationId = req.customerAuth!.organizationId;
    const orderNumber = req.params.orderNumber as string;

    const result = await storefrontAccountService.reorder(customerId, organizationId, orderNumber);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Items copied to cart",
      data: result
    });
  }),

  getLoyaltySummary: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const summary = await storefrontAccountService.getLoyaltySummary(customerId);

    res.status(StatusCodes.OK).json({
      success: true,
      data: summary
    });
  }),

  getLoyaltyLedger: asyncHandler(async (req: Request, res: Response) => {
    const customerId = req.customerAuth!.customerId;
    const ledger = await storefrontAccountService.getLoyaltyLedger(customerId);

    res.status(StatusCodes.OK).json({
      success: true,
      data: ledger
    });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    const customerAccountId = req.customerAuth!.customerAccountId;
    const account = await prisma.customerAccount.findUnique({
      where: { id: customerAccountId }
    });

    if (!account) {
      res.status(StatusCodes.UNAUTHORIZED).json({ success: false, message: "Account not found" });
      return;
    }

    const matches = await import("../../lib/password.js").then(m => m.verifyPassword(req.body.currentPassword, account.passwordHash));
    if (!matches) {
      res.status(StatusCodes.UNAUTHORIZED).json({ success: false, message: "Current password is incorrect" });
      return;
    }

    const nextPasswordHash = await hashPassword(req.body.newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.customerAccount.update({
        where: { id: customerAccountId },
        data: {
          passwordHash: nextPasswordHash,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 }
        }
      });

      // Revoke all sessions
      await tx.customerSession.updateMany({
        where: { customerAccountId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "PASSWORD_CHANGED" }
      });
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Password changed successfully"
    });
  }),

  listSessions: asyncHandler(async (req: Request, res: Response) => {
    const customerAccountId = req.customerAuth!.customerAccountId;
    const sessions = await prisma.customerSession.findMany({
      where: { customerAccountId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userAgent: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true
      }
    });

    res.status(StatusCodes.OK).json({
      success: true,
      data: sessions
    });
  }),

  revokeSession: asyncHandler(async (req: Request, res: Response) => {
    const customerAccountId = req.customerAuth!.customerAccountId;
    const sessionId = req.params.sessionId;

    const session = await prisma.customerSession.findFirst({
      where: { id: sessionId, customerAccountId }
    });

    if (!session) {
      res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Session not found" });
      return;
    }

    await prisma.customerSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_USER" }
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Session revoked successfully"
    });
  })
};
