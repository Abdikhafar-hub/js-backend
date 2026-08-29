import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export type CustomerTokenPayload = {
  customerAccountId: string;
  customerId: string;
  organizationId: string;
  sessionId: string;
  tokenVersion: number;
};

export const signCustomerAccessToken = (payload: CustomerTokenPayload) =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: "15m",
    audience: "storefront-customer",
    issuer: "js-perfumes-backend"
  });

export const signCustomerRefreshToken = (payload: CustomerTokenPayload) =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: "30d",
    audience: "storefront-customer",
    issuer: "js-perfumes-backend"
  });

export const verifyCustomerAccessToken = (token: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, {
    audience: "storefront-customer",
    issuer: "js-perfumes-backend"
  }) as CustomerTokenPayload;

export const verifyCustomerRefreshToken = (token: string) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET, {
    audience: "storefront-customer",
    issuer: "js-perfumes-backend"
  }) as CustomerTokenPayload;
