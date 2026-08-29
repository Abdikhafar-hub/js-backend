import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env.js";
import { cartService } from "./cart.service.js";
import { Prisma, CustomerType } from "@prisma/client";
import jwt from "jsonwebtoken";
import crypto from "crypto";

export interface CheckoutPreviewInput {
  cartToken: string;
  deliveryMethod: "DELIVERY" | "PICKUP";
  deliveryZoneId?: string;
  pickupBranchId?: string;
}

export interface PlaceOrderInput {
  checkoutToken: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paymentMethod?: string;
  idempotencyKey?: string;
  deliveryDetails?: {
    firstName: string;
    lastName: string;
    phone: string;
    alternatePhone?: string | null;
    email: string;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    county?: string | null;
  } | null;
}

// Phone normalization helper
function normalizePhone(phone: string): string {
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, "");
  // Standardize Kenyan formats: +2547... -> 07... or 2547... -> 07...
  if (digits.startsWith("254") && digits.length === 12) {
    return "0" + digits.substring(3);
  }
  return digits;
}

export const checkoutService = {
  /**
   * Generates a preview of the checkout with authoritative pricing, stock validation,
   * and returns a signed preview token.
   */
  async previewCheckout(organizationId: string, input: CheckoutPreviewInput) {
    const { cartToken, deliveryMethod, deliveryZoneId, pickupBranchId } = input;

    // 1. Get cart by token
    const cart = await prisma.cart.findFirst({
      where: { token: cartToken, organizationId },
      include: {
        items: true,
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Cart is empty or invalid", StatusCodes.BAD_REQUEST);
    }

    // 2. Validate stock availability
    const variantIds = cart.items.map((i) => i.productVariantId);
    
    // Fetch variant details
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds }, organizationId },
      include: {
        inventoryBalances: true,
        product: true,
      },
    });

    for (const item of cart.items) {
      const variant = variants.find((v) => v.id === item.productVariantId);
      if (!variant || variant.status !== "ACTIVE") {
        throw new AppError(
          ERROR_CODES.RESOURCE_NOT_FOUND,
          `Product item ${item.productVariantId} is no longer available`,
          StatusCodes.BAD_REQUEST
        );
      }

      if (deliveryMethod === "PICKUP") {
        if (!pickupBranchId) {
          throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Pickup branch is required for store pickup", StatusCodes.BAD_REQUEST);
        }
        // Check stock at specific branch
        const branchBalance = variant.inventoryBalances.find((ib) => ib.branchId === pickupBranchId);
        const qtyAvailable = branchBalance ? Number(branchBalance.quantityAvailable || 0) : 0;
        if (qtyAvailable < item.quantity) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Insufficient stock for "${variant.product.name}" at the selected pickup branch (Available: ${qtyAvailable}, Requested: ${item.quantity})`,
            StatusCodes.BAD_REQUEST
          );
        }
      } else {
        // DELIVERY - check total stock across all active retail branches
        const totalQtyAvailable = variant.inventoryBalances.reduce(
          (sum, ib) => sum + Math.max(0, Number(ib.quantityAvailable || 0)),
          0
        );
        if (totalQtyAvailable < item.quantity) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Insufficient stock for "${variant.product.name}" (Available: ${totalQtyAvailable}, Requested: ${item.quantity})`,
            StatusCodes.BAD_REQUEST
          );
        }
      }
    }

    // 3. Calculate Pricing
    const priceStockMap = await cartService.resolvePricingAndInventory(organizationId, variantIds);
    let subtotal = 0;
    
    const itemDetails = cart.items.map((item) => {
      const v = variants.find((x) => x.id === item.productVariantId)!;
      const info = priceStockMap.get(item.productVariantId) || { price: Number(v.retailPrice), stock: 0 };
      const lineTotal = info.price * item.quantity;
      subtotal += lineTotal;

      return {
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        unitPrice: info.price,
        lineTotal,
      };
    });

    let deliveryFee = 0;
    let resolvedDeliveryZoneId: string | null = null;

    if (deliveryMethod === "DELIVERY") {
      if (!deliveryZoneId) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Delivery zone is required for delivery orders", StatusCodes.BAD_REQUEST);
      }
      const zone = await prisma.deliveryZone.findFirst({
        where: { id: deliveryZoneId, organizationId, isActive: true },
      });
      if (!zone) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Delivery zone not found or is inactive", StatusCodes.BAD_REQUEST);
      }
      resolvedDeliveryZoneId = zone.id;
      
      // Calculate delivery fee with free threshold override
      if (zone.minAmountForFreeDelivery !== null && subtotal >= Number(zone.minAmountForFreeDelivery)) {
        deliveryFee = 0;
      } else {
        deliveryFee = Number(zone.fee);
      }
    }

    const totalAmount = subtotal + deliveryFee;
    const taxAmount = subtotal * (16 / 116); // 16% VAT inclusive

    // 4. Generate signed checkout preview token
    const payload = {
      organizationId,
      cartToken,
      items: itemDetails,
      subtotal,
      deliveryMethod,
      deliveryFee,
      deliveryZoneId: resolvedDeliveryZoneId,
      pickupBranchId: deliveryMethod === "PICKUP" ? pickupBranchId : null,
      taxAmount,
      totalAmount,
    };

    const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: "30m" });

    return {
      token,
      subtotal: String(subtotal),
      deliveryFee: String(deliveryFee),
      taxAmount: String(Math.round(taxAmount * 100) / 100),
      totalAmount: String(totalAmount),
      items: itemDetails.map((item) => {
        const v = variants.find((x) => x.id === item.productVariantId)!;
        return {
          variantId: item.productVariantId,
          productName: v.product.name,
          variantName: `${v.volumeValue}${v.volumeUnit || "ML"}`,
          quantity: item.quantity,
          price: String(item.unitPrice),
          lineTotal: String(item.lineTotal),
        };
      }),
    };
  },

  /**
   * Places an online order idempotently, matching/creating customer and emptying the cart.
   */
  async placeOrder(organizationId: string, input: PlaceOrderInput) {
    const { checkoutToken: previewToken, idempotencyKey, firstName, lastName, phone, email, paymentMethod, deliveryDetails } = input;

    // 1. Check idempotency
    if (idempotencyKey) {
      const existingOrder = await prisma.onlineOrder.findUnique({
        where: { idempotencyKey },
        include: {
          items: true,
          addressSnapshot: true,
        },
      });
      if (existingOrder) {
        return existingOrder;
      }
    }

    // 2. Decode & verify preview token
    let payload: any;
    try {
      payload = jwt.verify(previewToken, env.JWT_ACCESS_SECRET);
    } catch (err) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Invalid or expired checkout session preview. Please preview again.", StatusCodes.BAD_REQUEST);
    }

    if (payload.organizationId !== organizationId) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Invalid organization scope", StatusCodes.BAD_REQUEST);
    }

    const {
      cartToken,
      items,
      subtotal,
      deliveryMethod,
      deliveryFee,
      deliveryZoneId,
      pickupBranchId,
      taxAmount,
      totalAmount,
    } = payload;

    // Build address object from input
    const address = deliveryDetails || {
      firstName,
      lastName,
      phone,
      alternatePhone: null,
      email,
      addressLine1: "",
      addressLine2: null,
      city: "",
      county: null,
    };

    // 3. Confirm items in the cart haven't changed since the preview
    const currentCart = await prisma.cart.findFirst({
      where: { token: cartToken, organizationId },
      include: { items: true },
    });

    if (!currentCart) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Cart no longer exists", StatusCodes.BAD_REQUEST);
    }

    const cartMatch =
      currentCart.items.length === items.length &&
      currentCart.items.every((ci) => {
        const previewItem = items.find((pi: any) => pi.productVariantId === ci.productVariantId);
        return previewItem && previewItem.quantity === ci.quantity;
      });

    if (!cartMatch) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "Your cart items or quantities have changed since you previewed checkout. Please try again.",
        StatusCodes.BAD_REQUEST
      );
    }

    // 4. Customer Matching and Deduplication
    const normalizedPhone = normalizePhone(phone);
    const emailLower = email.toLowerCase().trim();

    // Query for existing customer matching normalized phone or email
    let customer = await prisma.customer.findFirst({
      where: {
        organizationId,
        OR: [
          phone ? { phone } : undefined,
          normalizedPhone ? { phone: normalizedPhone } : undefined,
          email ? { email: { equals: emailLower, mode: "insensitive" } } : undefined,
        ].filter(Boolean) as Prisma.CustomerWhereInput[],
      },
    });

    // If customer is found but is WALK_IN, ignore it and create a new RETAIL customer
    if (customer && customer.customerType === CustomerType.WALK_IN) {
      customer = null;
    }

    // Create customer if not found
    if (!customer) {
      const count = await prisma.customer.count({ where: { organizationId } });
      customer = await prisma.customer.create({
        data: {
          organizationId,
          customerNumber: `CUST-${String(count + 1).padStart(6, "0")}`,
          customerType: CustomerType.RETAIL,
          firstName,
          lastName,
          phone,
          email,
          address: address.addressLine1 || null,
          city: address.city || null,
          county: address.county || null,
          preferredBranchId: pickupBranchId || null,
        },
      });
    }

    // 5. Generate Safe sequential Order Number
    const orderCount = await prisma.onlineOrder.count({ where: { organizationId } });
    const orderNumber = `ONL-${String(orderCount + 1).padStart(6, "0")}`;

    // Generate random secure token for public lookup
    const publicToken = crypto.randomBytes(24).toString("hex");

    // 6. Create order inside a database transaction to keep it atomic
    const order = await prisma.$transaction(async (tx) => {
      // Create OnlineOrder record
      const newOrder = await tx.onlineOrder.create({
        data: {
          organizationId,
          orderNumber,
          customerId: customer.id,
          customerAccountId: currentCart.customerAccountId,
          cartId: currentCart.id,
          publicToken,
          status: "PENDING_PAYMENT",
          paymentStatus: "UNPAID",
          deliveryMethod,
          deliveryFee: new Prisma.Decimal(deliveryFee),
          deliveryZoneId: deliveryZoneId || null,
          pickupBranchId: pickupBranchId || null,
          subtotal: new Prisma.Decimal(subtotal),
          taxAmount: new Prisma.Decimal(taxAmount),
          totalAmount: new Prisma.Decimal(totalAmount),
          notes: null,
          idempotencyKey: idempotencyKey || null,
        },
      });

      // Fetch variant details to save name/sku snapshots
      const variants = await tx.productVariant.findMany({
        where: { id: { in: items.map((i: any) => i.productVariantId) } },
        include: { product: true },
      });

      // Create Order Items with snapshots
      for (const item of items) {
        const v = variants.find((x) => x.id === item.productVariantId)!;
        await tx.onlineOrderItem.create({
          data: {
            orderId: newOrder.id,
            productVariantId: item.productVariantId,
            skuSnapshot: v.sku,
            productNameSnapshot: v.product.name,
            variantNameSnapshot: `${v.volumeValue}${v.volumeUnit || "ML"}`,
            quantity: item.quantity,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            lineTotal: new Prisma.Decimal(item.lineTotal),
          },
        });
      }

      // Create Address Snapshot
      await tx.onlineOrderAddressSnapshot.create({
        data: {
          orderId: newOrder.id,
          firstName: address.firstName || firstName,
          lastName: address.lastName || lastName,
          phone: address.phone || phone,
          alternatePhone: address.alternatePhone || null,
          email: address.email || email,
          addressLine1: address.addressLine1 || "",
          addressLine2: address.addressLine2 || null,
          city: address.city || "",
          county: address.county || null,
          country: "Kenya",
        },
      });

      // Empty/Clear the cart items (so the cart is converted)
      await tx.cartItem.deleteMany({
        where: { cartId: currentCart.id },
      });

      return newOrder;
    });

    return prisma.onlineOrder.findUnique({
      where: { id: order.id },
      include: {
        items: true,
        addressSnapshot: true,
      },
    });
  },

  /**
   * Safe public lookup of a confirmed order details via public token.
   * Excludes internal database primary keys and sensitive fields.
   */
  async getOrderByPublicToken(organizationId: string, publicToken: string) {
    const order = await prisma.onlineOrder.findFirst({
      where: { publicToken, organizationId },
      include: {
        items: true,
        addressSnapshot: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            county: true,
          },
        },
        pickupBranch: {
          select: {
            name: true,
            address: true,
            phone: true,
          },
        },
        dispatch: true
      },
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found", StatusCodes.NOT_FOUND);
    }

    // Exclude internal ids
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfilmentStatus: order.fulfilmentStatus,
      deliveryMethod: order.deliveryMethod,
      deliveryFee: Number(order.deliveryFee),
      subtotal: Number(order.subtotal),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt,
      addressSnapshot: order.addressSnapshot,
      pickupBranch: order.pickupBranch,
      items: order.items.map((i) => ({
        productName: i.productNameSnapshot,
        variantName: i.variantNameSnapshot,
        sku: i.skuSnapshot,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
      })),
      dispatch: order.dispatch ? {
        courierName: order.dispatch.courierName,
        trackingNumber: order.dispatch.trackingNumber,
        driverName: order.dispatch.driverName,
        driverPhone: order.dispatch.driverPhone,
        status: order.dispatch.status,
        dispatchedAt: order.dispatch.dispatchedAt,
        deliveredAt: order.dispatch.deliveredAt
      } : null
    };
  },
};
