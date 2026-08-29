import { CustomerAccountStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { verifyCustomerAccessToken } from "../lib/customer-jwt.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const authenticateCustomer = asyncHandler(async (request, response, next) => {
  const authHeader = request.header("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError(
      ERROR_CODES.AUTHENTICATION_REQUIRED,
      "Authentication is required",
      StatusCodes.UNAUTHORIZED
    );
  }

  const token = authHeader.replace("Bearer ", "");
  let payload;
  try {
    payload = verifyCustomerAccessToken(token);
  } catch (err) {
    throw new AppError(
      ERROR_CODES.TOKEN_INVALID,
      "Session token is invalid or expired",
      StatusCodes.UNAUTHORIZED
    );
  }

  const account = await prisma.customerAccount.findUnique({
    where: {
      id: payload.customerAccountId,
      organizationId: payload.organizationId
    }
  });

  if (!account) {
    throw new AppError(
      ERROR_CODES.AUTHENTICATION_REQUIRED,
      "Customer account not found",
      StatusCodes.UNAUTHORIZED
    );
  }

  if (account.status !== CustomerAccountStatus.ACTIVE) {
    throw new AppError(
      ERROR_CODES.ACCESS_DENIED,
      `Customer account status is ${account.status}`,
      StatusCodes.FORBIDDEN
    );
  }

  if (account.tokenVersion !== payload.tokenVersion) {
    throw new AppError(
      ERROR_CODES.TOKEN_INVALID,
      "Session token is no longer valid",
      StatusCodes.UNAUTHORIZED
    );
  }

  request.customerAuth = {
    customerAccountId: account.id,
    customerId: account.customerId,
    organizationId: account.organizationId,
    sessionId: payload.sessionId,
    tokenVersion: payload.tokenVersion
  };

  next();
});
