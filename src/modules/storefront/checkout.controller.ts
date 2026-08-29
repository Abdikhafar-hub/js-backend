import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { checkoutService } from "../../services/checkout.service.js";
import { storefrontPaymentService } from "../../services/storefront-payment.service.js";
import { prisma } from "../../lib/prisma.js";
import { sendSuccess } from "../../utils/api-response.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";

const getOrganizationId = async (req: Request): Promise<string> => {
  if (req.auth?.organizationId) {
    return req.auth.organizationId;
  }
  const headerId = req.headers["x-organization-id"];
  if (headerId && typeof headerId === "string") {
    return headerId;
  }
  const firstOrg = await prisma.organization.findFirst({ select: { id: true } });
  return firstOrg?.id ?? "org_pulse_perfumes";
};

export const checkoutController = {
  async listActiveDeliveryZones(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const zones = await prisma.deliveryZone.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { fee: "asc" },
    });
    return sendSuccess(res, "Delivery zones fetched successfully", zones);
  },

  async preview(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const preview = await checkoutService.previewCheckout(orgId, req.body);
    return sendSuccess(res, "Checkout preview generated successfully", preview);
  },

  async placeOrder(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const order = await checkoutService.placeOrder(orgId, req.body);
    if (!order) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Failed to place order", StatusCodes.INTERNAL_SERVER_ERROR);
    }
    return sendSuccess(res, "Order placed successfully", {
      orderNumber: order.orderNumber,
      publicToken: order.publicToken,
      status: order.status,
    });
  },

  async getOrderByPublicToken(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const publicToken = req.params.publicToken!;
    const order = await checkoutService.getOrderByPublicToken(orgId, publicToken);
    return sendSuccess(res, "Order details fetched successfully", order);
  },

  async initiatePaymentAttempt(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const publicToken = req.params.publicToken!;
    const { method, phoneNumber } = req.body;
    const result = await storefrontPaymentService.initiatePaymentAttempt(orgId, publicToken, method, phoneNumber);
    return sendSuccess(res, "Payment attempt initiated successfully", result);
  },

  async getPaymentStatus(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const publicToken = req.params.publicToken!;
    const result = await storefrontPaymentService.getPaymentStatus(orgId, publicToken);
    return sendSuccess(res, "Payment status retrieved successfully", result);
  },

  async getPaymentAttemptsHistory(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const publicToken = req.params.publicToken!;
    const result = await storefrontPaymentService.getPaymentAttempts(orgId, publicToken);
    return sendSuccess(res, "Payment attempts history retrieved successfully", result);
  },
};
