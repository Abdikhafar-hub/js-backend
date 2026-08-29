import { Request, Response } from "express";
import { cartService } from "../../services/cart.service.js";
import { prisma } from "../../lib/prisma.js";
import { sendSuccess } from "../../utils/api-response.js";

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

export const cartController = {
  async createCart(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const { customerAccountId } = req.body;
    const cart = await cartService.createCart(orgId, customerAccountId);
    return sendSuccess(res, "Cart created successfully", cart);
  },

  async getCart(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const token = req.params.token!;
    const cart = await cartService.getCartByToken(orgId, token);
    return sendSuccess(res, "Cart retrieved successfully", cart);
  },

  async addItem(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const token = req.params.token!;
    const { productVariantId, quantity = 1 } = req.body;
    const cart = await cartService.addItemToCart(orgId, token, productVariantId as string, Number(quantity));
    return sendSuccess(res, "Item added to cart", cart);
  },

  async updateItem(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const token = req.params.token!;
    const { productVariantId, quantity } = req.body;
    const cart = await cartService.updateCartItemQuantity(orgId, token, productVariantId as string, Number(quantity));
    return sendSuccess(res, "Cart item updated", cart);
  },

  async removeItem(req: Request, res: Response) {
    const orgId = await getOrganizationId(req);
    const token = req.params.token!;
    const variantId = req.params.variantId!;
    const cart = await cartService.removeItemFromCart(orgId, token, variantId);
    return sendSuccess(res, "Item removed from cart", cart);
  },
};
