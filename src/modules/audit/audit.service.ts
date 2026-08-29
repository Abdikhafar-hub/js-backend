import { StatusCodes } from "http-status-codes";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { buildUserScope } from "../../lib/scope.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthContext } from "../../types/auth.js";

export const auditLogService = {
  list(auth: AuthContext) {
    const scope = buildUserScope(auth);
    return prisma.auditLog.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(scope.branchIds
          ? {
              OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }]
            }
          : {})
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 100
    });
  },
  async get(auth: AuthContext, id: string) {
    const scope = buildUserScope(auth);
    const record = await prisma.auditLog.findFirst({
      where: {
        id,
        organizationId: scope.organizationId,
        ...(scope.branchIds
          ? {
              OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }]
            }
          : {})
      }
    });

    if (!record) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Audit log not found", StatusCodes.NOT_FOUND);
    }

    return record;
  }
};
