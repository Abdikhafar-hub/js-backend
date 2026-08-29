import { UserStatus, type UserRole } from "@prisma/client";
import type { Request } from "express";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { hashPassword } from "../../lib/password.js";
import { serializeUser } from "../../lib/safe-response.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { prisma } from "../../lib/prisma.js";
import { auditService } from "../../services/audit.service.js";
import type { AuthContext } from "../../types/auth.js";

const assertUserManagementAuthority = (
  auth: AuthContext,
  targetRole: UserRole,
  requestedRole?: UserRole
) => {
  if (auth.role !== "BRANCH_MANAGER") return;
  if (targetRole !== "SALES_ATTENDANT" || (requestedRole && requestedRole !== "SALES_ATTENDANT")) {
    throw new AppError(
      ERROR_CODES.ACCESS_DENIED,
      "Branch Managers may only manage Sales Attendants in their assigned branches",
      StatusCodes.FORBIDDEN
    );
  }
};

const includeUserBranches = {
  branchAssignments: {
    where: {
      activeUntil: null
    },
    include: {
      branch: true
    }
  }
};

export const userService = {
  async list(auth: AuthContext) {
    const scope = buildUserScope(auth);
    const users = await prisma.user.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(scope.branchIds
          ? {
              branchAssignments: {
                some: {
                  branchId: {
                    in: scope.branchIds
                  },
                  activeUntil: null
                }
              }
            }
          : {})
      },
      include: includeUserBranches,
      orderBy: {
        createdAt: "desc"
      }
    });
    return serializeUser(users);
  },

  async create(
    auth: AuthContext,
    input: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      role: UserRole;
      status?: UserStatus;
      temporaryPassword: string;
      branchIds: string[];
      primaryBranchId: string;
    },
    request: Request
  ) {
    assertUserManagementAuthority(auth, input.role, input.role);
    input.branchIds.forEach((branchId) => assertBranchAccess(auth, branchId));

    const passwordHash = await hashPassword(input.temporaryPassword);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: auth.organizationId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone ?? null,
          role: input.role,
          status: input.status ?? UserStatus.ACTIVE,
          passwordHash,
          mustChangePassword: true
        }
      });

      await tx.userBranchAssignment.createMany({
        data: input.branchIds.map((branchId) => ({
          userId: user.id,
          branchId,
          isPrimary: input.primaryBranchId === branchId
        }))
      });

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: includeUserBranches
      });
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "user.create",
      entityType: "User",
      entityId: created.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      afterData: created
    });

    return serializeUser(created);
  },

  async get(auth: AuthContext, userId: string) {
    const scope = buildUserScope(auth);
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: scope.organizationId,
        ...(scope.branchIds
          ? {
              branchAssignments: {
                some: {
                  branchId: {
                    in: scope.branchIds
                  },
                  activeUntil: null
                }
              }
            }
          : {})
      },
      include: includeUserBranches
    });

    if (!user) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "User not found", StatusCodes.NOT_FOUND);
    }

    return serializeUser(user);
  },

  async update(
    auth: AuthContext,
    userId: string,
    input: Record<string, unknown>,
    request: Request
  ) {
    const before = await this.get(auth, userId);
    assertUserManagementAuthority(auth, before.role, input.role as UserRole | undefined);
    const updated = await prisma.user.update({
      where: { id: before.id },
      data: input as object,
      include: includeUserBranches
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "user.update",
      entityType: "User",
      entityId: updated.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: before,
      afterData: updated
    });

    return serializeUser(updated);
  },

  async assignBranches(
    auth: AuthContext,
    userId: string,
    input: { branchIds: string[]; primaryBranchId: string },
    request: Request
  ) {
    input.branchIds.forEach((branchId) => assertBranchAccess(auth, branchId));
    const target = await this.get(auth, userId);
    assertUserManagementAuthority(auth, target.role);

    const result = await prisma.$transaction(async (tx) => {
      await tx.userBranchAssignment.updateMany({
        where: {
          userId,
          activeUntil: null
        },
        data: {
          activeUntil: new Date()
        }
      });

      await tx.userBranchAssignment.createMany({
        data: input.branchIds.map((branchId) => ({
          userId,
          branchId,
          isPrimary: input.primaryBranchId === branchId
        }))
      });

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: includeUserBranches
      });
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "user.assignBranches",
      entityType: "User",
      entityId: userId,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      afterData: result
    });

    return serializeUser(result);
  },

  async resetPassword(
    auth: AuthContext,
    userId: string,
    temporaryPassword: string,
    request: Request
  ) {
    const target = await this.get(auth, userId);
    assertUserManagementAuthority(auth, target.role);
    const passwordHash = await hashPassword(temporaryPassword);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          tokenVersion: {
            increment: 1
          }
        }
      }),
      prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      })
    ]);

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "user.resetPassword",
      entityType: "User",
      entityId: userId,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent")
    });
  },

  activate(auth: AuthContext, userId: string, request: Request) {
    return this.update(auth, userId, { status: UserStatus.ACTIVE }, request);
  },

  suspend(auth: AuthContext, userId: string, request: Request) {
    return this.update(auth, userId, { status: UserStatus.SUSPENDED }, request);
  },

  meProfile(auth: AuthContext) {
    return this.get(auth, auth.userId);
  }
};
