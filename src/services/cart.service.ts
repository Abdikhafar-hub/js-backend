import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { StatusCodes } from "http-status-codes";
import crypto from "crypto";

import { resolvePublicMediaUrl } from "./storage/legacy-media.js";

export const cartService = {
  /**
   * Generates a new guest cart and return its token.
   */
  async createCart(organizationId: string, customerAccountId?: string) {
    const token = crypto.randomBytes(32).toString("hex");
    const cart = await prisma.cart.create({
      data: {
        organizationId,
        token,
        customerAccountId: customerAccountId || null,
      },
    });
    return cart;
  },

  /**
   * Resolves pricing and inventory for a given list of product variant IDs
   */
  async resolvePricingAndInventory(organizationId: string, variantIds: string[]) {
    if (variantIds.length === 0) return new Map<string, { price: number; stock: number }>();

    // Fetch variants and their inventory
    const variants = await prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        organizationId,
      },
      include: {
        inventoryBalances: true,
      },
    });

    // Fetch authoritative online or default retail prices
    const priceListItems = await prisma.priceListItem.findMany({
      where: {
        productVariantId: { in: variantIds },
        priceList: {
          organizationId,
          OR: [{ type: "ONLINE_RETAIL" }, { isDefault: true }],
        },
      },
      orderBy: {
        priceList: {
          type: "desc", // ONLINE_RETAIL takes priority
        },
      },
    });

    const result = new Map<string, { price: number; stock: number }>();

    for (const v of variants) {
      // Resolve price
      const matchedPriceItem = priceListItems.find((pi) => pi.productVariantId === v.id);
      const price = matchedPriceItem ? Number(matchedPriceItem.unitPrice) : Number(v.retailPrice);

      // Sum inventory availability across all branches
      const stock = v.inventoryBalances.reduce(
        (sum, ib) => sum + Math.max(0, Number(ib.quantityAvailable || 0)),
        0
      );

      result.set(v.id, { price, stock });
    }

    return result;
  },

  /**
   * Retrieves a cart by its token and serializes it with calculations
   */
  async getCartByToken(organizationId: string, token: string) {
    const cart = await prisma.cart.findFirst({
      where: { token, organizationId },
      include: {
        items: {
          include: {
            productVariant: {
              include: {
                product: {
                  include: {
                    brand: true,
                    media: {
                      where: { isPublished: true },
                      orderBy: { displayOrder: "asc" },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!cart) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Cart not found", StatusCodes.NOT_FOUND);
    }

    // Resolve pricing and stock info
    const variantIds = cart.items.map((i) => i.productVariantId);
    const priceStockMap = await this.resolvePricingAndInventory(organizationId, variantIds);

    const serializedItems = cart.items.map((item) => {
      const v = item.productVariant;
      const info = priceStockMap.get(v.id) || { price: Number(v.retailPrice), stock: 0 };

      return {
        id: item.id,
        productVariantId: v.id,
        quantity: item.quantity,
        resolvedPrice: String(info.price),
        lineTotal: String(info.price * item.quantity),
        isAvailable: info.stock > 0,
        maxAvailable: info.stock,
        variant: {
          id: v.id,
          sku: v.sku,
          label: `${v.volumeValue}${v.volumeUnit || "ML"}`,
          product: {
            name: v.product.name,
            brand: { name: v.product.brand?.name || "JS Perfumes" },
            media: v.product.media.map((m) => ({
              url: resolvePublicMediaUrl(m.url) ?? m.url,
              isPublished: m.isPublished,
            })),
          },
        },
      };
    });

    const subtotal = serializedItems.reduce((sum, item) => sum + Number(item.lineTotal), 0);
    const itemCount = serializedItems.reduce((sum, item) => sum + item.quantity, 0);

    return {
      id: cart.id,
      token: cart.token,
      customerAccountId: cart.customerAccountId,
      items: serializedItems,
      totals: {
        subtotal: String(subtotal),
        itemCount,
      },
    };
  },

  /**
   * Adds an item to the cart or increments its quantity if it already exists
   */
  async addItemToCart(organizationId: string, token: string, productVariantId: string, quantity: number) {
    const cart = await prisma.cart.findFirst({
      where: { token, organizationId },
    });

    if (!cart) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Cart not found", StatusCodes.NOT_FOUND);
    }

    // Verify product variant exists
    const variant = await prisma.productVariant.findFirst({
      where: { id: productVariantId, organizationId, status: "ACTIVE" },
    });

    if (!variant) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product variant not found or inactive", StatusCodes.NOT_FOUND);
    }

    // Check if item already in cart
    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productVariantId: {
          cartId: cart.id,
          productVariantId,
        },
      },
    });

    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: {
          quantity: existingItem.quantity + quantity,
        },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productVariantId,
          quantity,
        },
      });
    }

    return this.getCartByToken(organizationId, token);
  },

  /**
   * Sets/updates the quantity of an item directly
   */
  async updateCartItemQuantity(organizationId: string, token: string, productVariantId: string, quantity: number) {
    if (quantity <= 0) {
      return this.removeItemFromCart(organizationId, token, productVariantId);
    }

    const cart = await prisma.cart.findFirst({
      where: { token, organizationId },
    });

    if (!cart) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Cart not found", StatusCodes.NOT_FOUND);
    }

    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productVariantId: {
          cartId: cart.id,
          productVariantId,
        },
      },
    });

    if (!existingItem) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Item not found in cart", StatusCodes.NOT_FOUND);
    }

    await prisma.cartItem.update({
      where: { id: existingItem.id },
      data: { quantity },
    });

    return this.getCartByToken(organizationId, token);
  },

  /**
   * Removes an item from the cart
   */
  async removeItemFromCart(organizationId: string, token: string, productVariantId: string) {
    const cart = await prisma.cart.findFirst({
      where: { token, organizationId },
    });

    if (!cart) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Cart not found", StatusCodes.NOT_FOUND);
    }

    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productVariantId: {
          cartId: cart.id,
          productVariantId,
        },
      },
    });

    if (existingItem) {
      await prisma.cartItem.delete({
        where: { id: existingItem.id },
      });
    }

    return this.getCartByToken(organizationId, token);
  },
};
