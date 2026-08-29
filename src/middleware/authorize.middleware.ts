import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { hasPermission } from "../policies/role-permissions.js";
import type { Permission } from "../policies/permissions.js";

export const authorizePermission = (permission: Permission) => (request: Request) => {
  if (!request.auth) {
    throw new AppError(
      ERROR_CODES.AUTHENTICATION_REQUIRED,
      "Authentication is required",
      StatusCodes.UNAUTHORIZED
    );
  }

  if (!hasPermission(request.auth.role, permission)) {
    throw new AppError(ERROR_CODES.ACCESS_DENIED, "You do not have permission", StatusCodes.FORBIDDEN);
  }
};
