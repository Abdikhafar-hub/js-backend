import { UserRole } from "@prisma/client";

import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import type { AuthContext } from "../types/auth.js";

export type UserScope = {
  organizationId: string;
  branchIds?: string[];
};

export const buildUserScope = (auth: AuthContext): UserScope => {
  if (auth.role === UserRole.GENERAL_MANAGER) {
    return { organizationId: auth.organizationId };
  }

  return {
    organizationId: auth.organizationId,
    branchIds: auth.branchIds
  };
};

export const assertBranchAccess = (auth: AuthContext, branchId: string) => {
  if (auth.role === UserRole.GENERAL_MANAGER) {
    return;
  }

  if (!auth.branchIds.includes(branchId)) {
    throw new AppError(ERROR_CODES.BRANCH_ACCESS_DENIED, "Branch access denied", 403);
  }
};
