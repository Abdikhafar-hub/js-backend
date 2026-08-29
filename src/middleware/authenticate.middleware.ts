import { UserStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const authenticate = asyncHandler(async (request, response, next) => {
  const authHeader = request.header("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError(
      ERROR_CODES.AUTHENTICATION_REQUIRED,
      "Authentication is required",
      StatusCodes.UNAUTHORIZED
    );
  }

  const token = authHeader.replace("Bearer ", "");
  const payload = verifyAccessToken(token);

  const user = await prisma.user.findFirst({
    where: {
      id: payload.sub,
      organizationId: payload.organizationId
    },
    include: {
      branchAssignments: {
        where: {
          activeUntil: null
        }
      }
    }
  });

  if (!user) {
    throw new AppError(ERROR_CODES.AUTHENTICATION_REQUIRED, "User not found", StatusCodes.UNAUTHORIZED);
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError(ERROR_CODES.USER_SUSPENDED, "User is suspended", StatusCodes.FORBIDDEN);
  }

  request.auth = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    sessionId: payload.sessionId,
    tokenVersion: payload.tokenVersion,
    branchIds: user.branchAssignments.map((assignment) => assignment.branchId)
  };
  response.locals.auth = request.auth;

  next();
});
