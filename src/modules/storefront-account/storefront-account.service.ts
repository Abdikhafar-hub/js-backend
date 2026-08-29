import { CustomerStatus, CustomerType, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { randomUUID } from "crypto";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { prisma } from "../../lib/prisma.js";
import { normalizeEmail, normalizePhone } from "../../utils/normalize.js";

type AddressInput = {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  county?: string | null;
  country?: string;
  isPrimaryShipping?: boolean;
  isPrimaryBilling?: boolean;
};

export const storefrontAccountService = {
  async getProfile(customerAccountId: string) {
    const account = await prisma.customerAccount.findUnique({
      where: { id: customerAccountId },
      include: {
        customer: true
      }
    });

    if (!account) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Profile not found", StatusCodes.NOT_FOUND);
    }

    return {
      id: account.id,
      customerId: account.customerId,
      firstName: account.customer.firstName,
      lastName: account.customer.lastName,
      email: account.email,
      phone: account.phoneNumber,
      status: account.status,
      customerNumber: account.customer.customerNumber,
      customerType: account.customer.customerType,
      memberSince: account.createdAt
    };
  },

  async updateProfile(
    customerAccountId: string,
    organizationId: string,
    input: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
    }
  ) {
    const account = await prisma.customerAccount.findUnique({
      where: { id: customerAccountId },
      include: { customer: true }
    });

    if (!account) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Profile not found", StatusCodes.NOT_FOUND);
    }

    const updateData: Prisma.CustomerAccountUpdateInput = {};
    const customerData: Prisma.CustomerUpdateInput = {};

    if (input.firstName !== undefined) {
      customerData.firstName = input.firstName;
    }
    if (input.lastName !== undefined) {
      customerData.lastName = input.lastName;
    }

    if (input.email !== undefined) {
      const normEmail = input.email ? normalizeEmail(input.email) : null;
      if (normEmail !== account.normalizedEmail) {
        // Ensure no email collisions
        if (normEmail) {
          const duplicate = await prisma.customerAccount.findFirst({
            where: { organizationId, normalizedEmail: normEmail, id: { not: customerAccountId } }
          });
          if (duplicate) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, "Email is already in use", StatusCodes.CONFLICT);
          }
        }
        updateData.email = input.email || null;
        updateData.normalizedEmail = normEmail;
        customerData.email = normEmail;
      }
    }

    if (input.phone !== undefined) {
      const normPhone = normalizePhone(input.phone);
      if (normPhone !== account.normalizedPhoneNumber) {
        // Ensure no phone collisions
        if (normPhone) {
          const duplicate = await prisma.customerAccount.findFirst({
            where: { organizationId, normalizedPhoneNumber: normPhone, id: { not: customerAccountId } }
          });
          if (duplicate) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, "Phone number is already in use", StatusCodes.CONFLICT);
          }
        }
        updateData.phoneNumber = input.phone;
        updateData.normalizedPhoneNumber = normPhone;
        customerData.phone = normPhone;
      }
    }

    return prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: account.customerId },
        data: customerData
      });

      const updatedAccount = await tx.customerAccount.update({
        where: { id: customerAccountId },
        data: updateData,
        include: { customer: true }
      });

      return {
        id: updatedAccount.id,
        customerId: updatedAccount.customerId,
        firstName: updatedAccount.customer.firstName,
        lastName: updatedAccount.customer.lastName,
        email: updatedAccount.email,
        phone: updatedAccount.phoneNumber,
        status: updatedAccount.status,
        customerNumber: updatedAccount.customer.customerNumber,
        customerType: updatedAccount.customer.customerType,
        memberSince: updatedAccount.createdAt
      };
    });
  },

  async listAddresses(customerId: string) {
    return prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" }
    });
  },

  async createAddress(customerId: string, input: AddressInput) {
    return prisma.$transaction(async (tx) => {
      // If setting as primary shipping/billing, clear previous default flags
      if (input.isPrimaryShipping) {
        await tx.customerAddress.updateMany({
          where: { customerId, isPrimaryShipping: true },
          data: { isPrimaryShipping: false }
        });
      }
      if (input.isPrimaryBilling) {
        await tx.customerAddress.updateMany({
          where: { customerId, isPrimaryBilling: true },
          data: { isPrimaryBilling: false }
        });
      }

      // If this is the first address, default it to primary shipping & billing
      const count = await tx.customerAddress.count({ where: { customerId } });
      const makePrimary = count === 0;

      return tx.customerAddress.create({
        data: {
          customerId,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 || null,
          city: input.city,
          county: input.county || null,
          country: input.country || "Kenya",
          isPrimaryShipping: makePrimary || !!input.isPrimaryShipping,
          isPrimaryBilling: makePrimary || !!input.isPrimaryBilling
        }
      });
    });
  },

  async updateAddress(customerId: string, addressId: string, input: AddressInput) {
    const address = await prisma.customerAddress.findFirst({
      where: { id: addressId, customerId }
    });

    if (!address) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Address not found or access denied", StatusCodes.NOT_FOUND);
    }

    return prisma.$transaction(async (tx) => {
      if (input.isPrimaryShipping) {
        await tx.customerAddress.updateMany({
          where: { customerId, isPrimaryShipping: true, id: { not: addressId } },
          data: { isPrimaryShipping: false }
        });
      }
      if (input.isPrimaryBilling) {
        await tx.customerAddress.updateMany({
          where: { customerId, isPrimaryBilling: true, id: { not: addressId } },
          data: { isPrimaryBilling: false }
        });
      }

      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 !== undefined ? input.addressLine2 : undefined,
          city: input.city,
          county: input.county !== undefined ? input.county : undefined,
          country: input.country || undefined,
          isPrimaryShipping: input.isPrimaryShipping !== undefined ? input.isPrimaryShipping : undefined,
          isPrimaryBilling: input.isPrimaryBilling !== undefined ? input.isPrimaryBilling : undefined
        }
      });
    });
  },

  async deleteAddress(customerId: string, addressId: string) {
    const address = await prisma.customerAddress.findFirst({
      where: { id: addressId, customerId }
    });

    if (!address) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Address not found or access denied", StatusCodes.NOT_FOUND);
    }

    return prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id: addressId } });

      // If we deleted primary shipping/billing, assign them to the next available address
      if (address.isPrimaryShipping || address.isPrimaryBilling) {
        const nextAddress = await tx.customerAddress.findFirst({
          where: { customerId },
          orderBy: { createdAt: "desc" }
        });

        if (nextAddress) {
          await tx.customerAddress.update({
            where: { id: nextAddress.id },
            data: {
              isPrimaryShipping: address.isPrimaryShipping ? true : undefined,
              isPrimaryBilling: address.isPrimaryBilling ? true : undefined
            }
          });
        }
      }
    });
  },

  async setDefaultAddress(customerId: string, addressId: string) {
    const address = await prisma.customerAddress.findFirst({
      where: { id: addressId, customerId }
    });

    if (!address) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Address not found or access denied", StatusCodes.NOT_FOUND);
    }

    await prisma.$transaction([
      prisma.customerAddress.updateMany({
        where: { customerId, isPrimaryShipping: true },
        data: { isPrimaryShipping: false }
      }),
      prisma.customerAddress.update({
        where: { id: addressId },
        data: { isPrimaryShipping: true }
      })
    ]);
  },

  async listOrders(customerId: string, organizationId: string, query: { page?: string; limit?: string; status?: string }) {
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(query.limit || "10", 10)));

    const where: Prisma.OnlineOrderWhereInput = {
      customerId,
      organizationId,
      ...(query.status ? { status: query.status } : {})
    };

    const [total, records] = await Promise.all([
      prisma.onlineOrder.count({ where }),
      prisma.onlineOrder.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            include: {
              productVariant: {
                include: {
                  product: {
                    include: {
                      media: { take: 1 }
                    }
                  }
                }
              }
            }
          }
        }
      })
    ]);

    return {
      items: records.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfilmentStatus: order.fulfilmentStatus,
        totalAmount: order.totalAmount,
        deliveryMethod: order.deliveryMethod,
        itemCount: order.items.reduce((sum, item) => sum + Number(item.quantity), 0),
        items: order.items.map(item => ({
          name: item.productVariant.product.name,
          sku: item.productVariant.sku,
          image: item.productVariant.product.media[0]?.url || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice
        }))
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  async getOrderDetails(customerId: string, organizationId: string, orderNumber: string) {
    const order = await prisma.onlineOrder.findFirst({
      where: { customerId, organizationId, orderNumber },
      include: {
        pickupBranch: { select: { id: true, name: true, code: true } },
        deliveryZone: { select: { id: true, name: true } },
        dispatch: {
          select: {
            courierName: true,
            courierService: true,
            trackingNumber: true,
            driverName: true,
            driverPhone: true,
            status: true,
            dispatchedAt: true,
            deliveredAt: true
          }
        },
        items: {
          include: {
            productVariant: {
              include: {
                product: {
                  include: {
                    media: true
                  }
                }
              }
            }
          }
        },
        paymentAttempts: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            createdAt: true,
            failureMessage: true
          }
        }
      }
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found or access denied", StatusCodes.NOT_FOUND);
    }

    return order;
  },

  async linkGuestOrders(customerId: string, organizationId: string, phone: string, email?: string | null) {
    const normPhone = normalizePhone(phone);
    const normEmail = email ? normalizeEmail(email) : null;

    // Find any unlinked guest orders matching phone or email placed within the last 90 days
    const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const guestOrders = await prisma.onlineOrder.findMany({
      where: {
        organizationId,
        customerAccountId: null,
        createdAt: { gte: windowStart },
        customer: {
          OR: [
            normPhone ? { phone: normPhone } : undefined,
            normEmail ? { email: normEmail } : undefined
          ].filter(Boolean) as Prisma.CustomerWhereInput[]
        }
      }
    });

    if (!guestOrders.length) {
      return { linkedCount: 0 };
    }

    const account = await prisma.customerAccount.findUnique({
      where: { customerId }
    });

    await prisma.onlineOrder.updateMany({
      where: { id: { in: guestOrders.map(o => o.id) } },
      data: {
        customerId,
        customerAccountId: account?.id || null
      }
    });

    return { linkedCount: guestOrders.length };
  },

  async reorder(customerId: string, organizationId: string, orderNumber: string) {
    // 1. Get original order
    const order = await prisma.onlineOrder.findFirst({
      where: { customerId, organizationId, orderNumber },
      include: {
        items: {
          include: {
            productVariant: true
          }
        }
      }
    });

    if (!order) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found or access denied", StatusCodes.NOT_FOUND);
    }

    // 2. Create or find active cart
    const cartToken = randomUUID();

    const cart = await prisma.cart.create({
      data: {
        organizationId,
        token: cartToken
      }
    });

    // 3. Populate cart items validating published status & active pricing
    const skippedItems: string[] = [];
    const addedItemsCount = 0;

    for (const item of order.items) {
      // Find current pricing & published state for variant
      const variant = await prisma.productVariant.findFirst({
        where: {
          id: item.productVariantId,
          status: "ACTIVE",
          product: {
            isActive: true,
            storefrontProfile: {
              isPublished: true
            }
          }
        },
        include: {
          priceListItems: {
            where: {
              priceList: {
                name: "Online Retail"
              }
            }
          }
        }
      });

      if (!variant) {
        skippedItems.push(`${item.productVariantId} (No longer active/published)`);
        continue;
      }

      const onlinePriceItem = variant.priceListItems[0];
      if (!onlinePriceItem && !variant.retailPrice) {
        skippedItems.push(`${variant.sku} (No retail pricing found)`);
        continue;
      }

      // Add item to cart
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productVariantId: variant.id,
          quantity: item.quantity
        }
      });
    }

    return {
      cartToken,
      skippedItems
    };
  },

  async getLoyaltySummary(customerId: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { loyaltyPointsBalance: true }
    });

    if (!customer) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer not found", StatusCodes.NOT_FOUND);
    }

    const earnedAgg = await prisma.loyaltyLedgerEntry.aggregate({
      where: { customerId, entryType: "EARNED" },
      _sum: { points: true }
    });

    const redeemedAgg = await prisma.loyaltyLedgerEntry.aggregate({
      where: { customerId, entryType: "REDEEMED" },
      _sum: { points: true }
    });

    return {
      pointsBalance: customer.loyaltyPointsBalance,
      lifetimeEarned: earnedAgg._sum.points || 0,
      lifetimeRedeemed: redeemedAgg._sum.points || 0
    };
  },

  async getLoyaltyLedger(customerId: string) {
    return prisma.loyaltyLedgerEntry.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" }
    });
  }
};
