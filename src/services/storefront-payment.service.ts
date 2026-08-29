import { StatusCodes } from "http-status-codes";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { decrypt } from "../utils/crypto.js";
import { nanoid } from "nanoid";

export function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  
  if (cleaned.startsWith("254")) {
    // Already has country code
  } else if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.substring(1);
  } else if (cleaned.startsWith("7") || cleaned.startsWith("1")) {
    cleaned = "254" + cleaned;
  }

  if (!/^254[71]\d{8}$/.test(cleaned)) {
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      "Invalid Safaricom phone number format. Must start with 07, 01, 2547, or 2541 followed by 8 digits.",
      StatusCodes.BAD_REQUEST
    );
  }
  return cleaned;
}

export function maskPhoneNumber(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.trim();
  if (cleaned.length < 7) return cleaned;
  return cleaned.substring(0, 4) + "****" + cleaned.substring(cleaned.length - 4);
}

export const storefrontPaymentService = {
  /**
   * Initiate a payment attempt for a storefront order.
   */
  async initiatePaymentAttempt(
    organizationId: string,
    publicToken: string,
    method: "MPESA" | "CASH_ON_DELIVERY",
    phoneNumber?: string
  ) {
    const order = await prisma.onlineOrder.findFirst({
      where: { publicToken, organizationId },
      include: {
        addressSnapshot: true,
      },
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found", StatusCodes.NOT_FOUND);
    }

    if (order.status !== "PENDING_PAYMENT") {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `Order is not in a payable state (current status: ${order.status})`,
        StatusCodes.BAD_REQUEST
      );
    }

    // Cooldown check: prevent rapid double-clicks (e.g. within 15 seconds)
    const recentAttempt = await prisma.onlineOrderPaymentAttempt.findFirst({
      where: { onlineOrderId: order.id },
      orderBy: { createdAt: "desc" },
    });

    if (
      recentAttempt &&
      (recentAttempt.status === "INITIATED" || recentAttempt.status === "PENDING") &&
      Date.now() - new Date(recentAttempt.createdAt).getTime() < 15000
    ) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "A payment request is already pending. Please wait 15 seconds before retrying.",
        StatusCodes.TOO_MANY_REQUESTS
      );
    }

    const idempotencyKey = nanoid();

    if (method === "MPESA") {
      if (!phoneNumber) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Phone number is required for M-Pesa", StatusCodes.BAD_REQUEST);
      }
      
      const normalizedPhone = normalizePhoneNumber(phoneNumber);

      const mpesaConfig = await prisma.mpesaConfiguration.findUnique({
        where: { organizationId },
      });

      if (!mpesaConfig) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "M-Pesa payment method is not configured", StatusCodes.PRECONDITION_FAILED);
      }

      // Create Payment Attempt
      const attempt = await prisma.onlineOrderPaymentAttempt.create({
        data: {
          organizationId,
          onlineOrderId: order.id,
          method: "MPESA",
          status: "PENDING",
          amount: order.totalAmount,
          currency: "KES",
          phoneNumber: normalizedPhone,
          idempotencyKey,
          checkoutRequestId: `STK-${idempotencyKey}`,
          initiatedAt: new Date(),
        },
      });

      // Also create matching MpesaTransaction in database to integrate with existing webhook callback flow
      const merchantRequestId = `STOREFRONT-${Date.now()}-${organizationId.slice(-6)}`;
      await prisma.mpesaTransaction.create({
        data: {
          organizationId,
          branchId: order.pickupBranchId || (await prisma.branch.findFirst({ where: { organizationId } }))?.id || "default_branch",
          onlineOrderId: order.id,
          merchantRequestID: merchantRequestId,
          checkoutRequestID: `STK-${idempotencyKey}`,
          amount: order.totalAmount,
          phoneNumber: normalizedPhone,
          status: "PENDING",
        },
      });

      // Update attempt with merchantRequestId reference
      await prisma.onlineOrderPaymentAttempt.update({
        where: { id: attempt.id },
        data: { merchantRequestId },
      });

      // Handle Sandbox Mocks or Production calls
      if (mpesaConfig.environment === "production") {
        // Safe production gate - throw error until live credentials/adaptor is explicitly verified
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          "Production M-Pesa provider adapter is not configured",
          StatusCodes.SERVICE_UNAVAILABLE
        );
      }

      return {
        success: true,
        attemptId: attempt.id,
        status: "PENDING",
        checkoutRequestId: `STK-${idempotencyKey}`,
        message: "STK push request initiated successfully (Sandbox Mode)",
      };
    } else if (method === "CASH_ON_DELIVERY") {
      // 1. Verify COD Eligibility
      const settings = await prisma.organizationSetting.findUnique({
        where: { organizationId },
      });

      if (!settings || !settings.cashOnDeliveryEnabled) {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          "Cash on Delivery is not available for this store.",
          StatusCodes.BAD_REQUEST
        );
      }

      if (Number(order.totalAmount) > Number(settings.cashOnDeliveryMaximumOrderAmount)) {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          `Order total KSh ${Number(order.totalAmount).toLocaleString()} exceeds maximum COD limit of KSh ${Number(settings.cashOnDeliveryMaximumOrderAmount).toLocaleString()}`,
          StatusCodes.BAD_REQUEST
        );
      }

      if (
        settings.cashOnDeliveryAllowedZoneIds.length > 0 &&
        (!order.deliveryZoneId || !settings.cashOnDeliveryAllowedZoneIds.includes(order.deliveryZoneId))
      ) {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          "Cash on Delivery is not available for your chosen delivery zone.",
          StatusCodes.BAD_REQUEST
        );
      }

      const requiresConfirmation = settings.cashOnDeliveryRequiresConfirmation;

      // Create Payment Attempt
      const attempt = await prisma.onlineOrderPaymentAttempt.create({
        data: {
          organizationId,
          onlineOrderId: order.id,
          method: "CASH_ON_DELIVERY",
          status: requiresConfirmation ? "PENDING" : "COMPLETED",
          amount: order.totalAmount,
          currency: "KES",
          idempotencyKey,
          initiatedAt: new Date(),
          completedAt: requiresConfirmation ? null : new Date(),
        },
      });

      if (!requiresConfirmation) {
        // Instantly confirm order & mark payment status UNPAID (collected at delivery)
        await prisma.onlineOrder.update({
          where: { id: order.id },
          data: {
            status: "PLACED",
            paymentStatus: "UNPAID",
          },
        });
      }

      return {
        success: true,
        attemptId: attempt.id,
        status: attempt.status,
        requiresConfirmation,
        message: requiresConfirmation
          ? "Cash on Delivery requires manual confirmation from administration."
          : "Cash on Delivery confirmed successfully. Your order is placed.",
      };
    } else {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Unsupported payment method", StatusCodes.BAD_REQUEST);
    }
  },

  /**
   * Manually confirm a Cash on Delivery pending attempt (Admin panel trigger).
   */
  async confirmCashOnDelivery(organizationId: string, orderId: string, userId: string) {
    const order = await prisma.onlineOrder.findFirst({
      where: { id: orderId, organizationId },
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found", StatusCodes.NOT_FOUND);
    }

    const pendingCOD = await prisma.onlineOrderPaymentAttempt.findFirst({
      where: {
        onlineOrderId: orderId,
        method: "CASH_ON_DELIVERY",
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
    });

    if (!pendingCOD) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "No pending Cash on Delivery attempt found for this order",
        StatusCodes.BAD_REQUEST
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.onlineOrderPaymentAttempt.update({
        where: { id: pendingCOD.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });

      await tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          status: "PLACED",
          paymentStatus: "UNPAID",
        },
      });
    });

    return { success: true, message: "Cash on delivery confirmed successfully" };
  },

  /**
   * Public polling endpoint: get order status and latest attempt status.
   */
  async getPaymentStatus(organizationId: string, publicToken: string) {
    const order = await prisma.onlineOrder.findFirst({
      where: { publicToken, organizationId },
      include: {
        paymentAttempts: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found", StatusCodes.NOT_FOUND);
    }

    const latestAttempt = order.paymentAttempts[0] || null;

    return {
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      latestAttempt: latestAttempt
        ? {
            method: latestAttempt.method,
            status: latestAttempt.status,
            phoneNumber: maskPhoneNumber(latestAttempt.phoneNumber),
            failureCode: latestAttempt.failureCode,
            failureMessage: latestAttempt.failureMessage,
            initiatedAt: latestAttempt.initiatedAt,
            completedAt: latestAttempt.completedAt,
          }
        : null,
    };
  },

  /**
   * Public history endpoint: list all payment attempts for an order.
   */
  async getPaymentAttempts(organizationId: string, publicToken: string) {
    const order = await prisma.onlineOrder.findFirst({
      where: { publicToken, organizationId },
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found", StatusCodes.NOT_FOUND);
    }

    const attempts = await prisma.onlineOrderPaymentAttempt.findMany({
      where: { onlineOrderId: order.id },
      orderBy: { createdAt: "desc" },
    });

    return attempts.map((a) => ({
      id: a.id,
      method: a.method,
      status: a.status,
      amount: Number(a.amount),
      currency: a.currency,
      phoneNumber: maskPhoneNumber(a.phoneNumber),
      failureMessage: a.failureMessage,
      createdAt: a.createdAt,
      completedAt: a.completedAt,
    }));
  },
};
