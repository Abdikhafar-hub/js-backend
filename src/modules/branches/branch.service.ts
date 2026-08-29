import {
  UserRole,
  UserStatus,
  type BranchStatus,
  type Prisma,
  type User
} from "@prisma/client";
import type { Request } from "express";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { hashPassword } from "../../lib/password.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { prisma } from "../../lib/prisma.js";
import { hasPermission } from "../../policies/role-permissions.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { auditService } from "../../services/audit.service.js";
import type { AuthContext } from "../../types/auth.js";
import { normalizeEmail, normalizePhone } from "../../utils/normalize.js";

type BranchCreateInput = {
  code: string;
  name: string;
  branchType: Prisma.BranchCreateInput["branchType"];
  phone?: string;
  email?: string;
  city?: string;
  county?: string;
  address?: string;
  isHeadOffice?: boolean;
  isWarehouse?: boolean;
  allowsNegativeStock?: boolean;
  manager?:
    | {
        mode: "CREATE_NEW";
        firstName: string;
        lastName: string;
        phone: string;
        email: string;
        password: string;
      }
    | {
        mode: "ASSIGN_EXISTING";
        userId: string;
        confirmReassignment?: boolean;
      };
};

type BranchManagerSummary = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: "BRANCH_MANAGER";
  status: UserStatus;
  branchId: string;
  mustChangePassword: boolean;
  assignedAt: Date | null;
  lastLoginAt: Date | null;
};

const activeManagerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true
} satisfies Prisma.UserSelect;

const getBranchWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { id: { in: scope.branchIds } } : {})
  };
};

const toNullableTrimmed = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeBranchCreateInput = (input: BranchCreateInput) => ({
  code: input.code.trim().toUpperCase(),
  name: input.name.trim(),
  branchType: input.branchType,
  phone: input.phone ? normalizePhone(input.phone) : null,
  email: input.email ? normalizeEmail(input.email) : null,
  city: toNullableTrimmed(input.city),
  county: toNullableTrimmed(input.county),
  address: toNullableTrimmed(input.address),
  isHeadOffice: Boolean(input.isHeadOffice),
  isWarehouse: Boolean(input.isWarehouse),
  allowsNegativeStock: Boolean(input.allowsNegativeStock)
});

const normalizeBranchUpdateInput = (input: Record<string, unknown>) => ({
  ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
  ...(input.branchType !== undefined ? { branchType: input.branchType as Prisma.BranchUpdateInput["branchType"] } : {}),
  ...(input.phone !== undefined
    ? { phone: input.phone ? normalizePhone(String(input.phone)) : null }
    : {}),
  ...(input.email !== undefined
    ? { email: input.email ? normalizeEmail(String(input.email)) : null }
    : {}),
  ...(input.address !== undefined ? { address: toNullableTrimmed(String(input.address || "")) } : {}),
  ...(input.city !== undefined ? { city: toNullableTrimmed(String(input.city || "")) } : {}),
  ...(input.county !== undefined ? { county: toNullableTrimmed(String(input.county || "")) } : {}),
  ...(input.allowsNegativeStock !== undefined
    ? { allowsNegativeStock: Boolean(input.allowsNegativeStock) }
    : {}),
  ...(input.status !== undefined ? { status: input.status as BranchStatus } : {})
});

const assertBranchManagerAssignmentPermission = (auth: AuthContext) => {
  if (!hasPermission(auth.role, PERMISSIONS.branchManagerAssign)) {
    throw new AppError(
      ERROR_CODES.ACCESS_DENIED,
      "You do not have permission to assign branch managers",
      StatusCodes.FORBIDDEN
    );
  }
};

const formatManagerSummary = (
  manager: Pick<
    User,
    "id" | "firstName" | "lastName" | "email" | "phone" | "role" | "mustChangePassword" | "lastLoginAt"
  > & { status: UserStatus },
  branchId: string,
  assignedAt: Date | null
): BranchManagerSummary => ({
  id: manager.id,
  firstName: manager.firstName,
  lastName: manager.lastName,
  email: manager.email,
  phone: manager.phone,
  role: UserRole.BRANCH_MANAGER,
  status: manager.status,
  branchId,
  mustChangePassword: manager.mustChangePassword,
  assignedAt,
  lastLoginAt: manager.lastLoginAt
});

const getManagedBranch = (tx: Prisma.TransactionClient, organizationId: string, userId: string) =>
  tx.branch.findFirst({
    where: {
      organizationId,
      managerUserId: userId
    },
    select: {
      id: true,
      code: true,
      name: true
    }
  });

const deactivateActiveBranchAssignments = async (
  tx: Prisma.TransactionClient,
  userId: string
) => {
  await tx.userBranchAssignment.updateMany({
    where: {
      userId,
      activeUntil: null
    },
    data: {
      activeUntil: new Date(),
      isPrimary: false
    }
  });
};

const setPrimaryBranchAssignment = async (
  tx: Prisma.TransactionClient,
  userId: string,
  branchId: string
) => {
  await deactivateActiveBranchAssignments(tx, userId);

  await tx.userBranchAssignment.upsert({
    where: {
      userId_branchId: {
        userId,
        branchId
      }
    },
    update: {
      activeUntil: null,
      activeFrom: new Date(),
      isPrimary: true
    },
    create: {
      userId,
      branchId,
      isPrimary: true
    }
  });
};

const clearBranchManager = async (tx: Prisma.TransactionClient, branchId: string) => {
  const branch = await tx.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      organizationId: true,
      managerUserId: true
    }
  });

  if (!branch?.managerUserId) {
    return null;
  }

  await tx.branch.update({
    where: { id: branch.id },
    data: {
      managerUserId: null
    }
  });

  await deactivateActiveBranchAssignments(tx, branch.managerUserId);

  return branch.managerUserId;
};

const createManagerUser = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
  manager: Extract<NonNullable<BranchCreateInput["manager"]>, { mode: "CREATE_NEW" }>
) => {
  const normalizedEmail = normalizeEmail(manager.email);
  const normalizedPhone = normalizePhone(manager.phone);

  const existingEmail = await tx.user.findFirst({
    where: {
      email: normalizedEmail
    },
    select: { id: true }
  });

  if (existingEmail) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "Manager email already exists",
      StatusCodes.CONFLICT,
      {
        fieldErrors: {
          "manager.email": "This email is already in use."
        }
      }
    );
  }

  const passwordHash = await hashPassword(manager.password);
  const user = await tx.user.create({
    data: {
      organizationId,
      firstName: manager.firstName.trim(),
      lastName: manager.lastName.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash,
      role: UserRole.BRANCH_MANAGER,
      status: UserStatus.ACTIVE,
      mustChangePassword: true
    },
    select: activeManagerSelect
  });

  await setPrimaryBranchAssignment(tx, user.id, branchId);

  return user;
};

const assignExistingManager = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
  manager: Extract<NonNullable<BranchCreateInput["manager"]>, { mode: "ASSIGN_EXISTING" }>
) => {
  const user = await tx.user.findFirst({
    where: {
      id: manager.userId,
      organizationId
    },
    select: activeManagerSelect
  });

  if (!user) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Manager user not found", StatusCodes.NOT_FOUND, {
      fieldErrors: {
        managerUserId: "The selected manager could not be found."
      }
    });
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Only active users can be assigned", StatusCodes.BAD_REQUEST, {
      fieldErrors: {
        managerUserId: "Only active users can be assigned as branch managers."
      }
    });
  }

  if (user.role === UserRole.GENERAL_MANAGER) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "General Managers cannot be assigned as branch managers",
      StatusCodes.BAD_REQUEST,
      {
        fieldErrors: {
          managerUserId: "General Managers cannot be assigned as branch managers."
        }
      }
    );
  }

  const existingManagedBranch = await getManagedBranch(tx, organizationId, user.id);

  if (existingManagedBranch && existingManagedBranch.id !== branchId && !manager.confirmReassignment) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "Manager is already assigned to another branch",
      StatusCodes.CONFLICT,
      {
        fieldErrors: {
          managerUserId: `Already assigned to ${existingManagedBranch.name} (${existingManagedBranch.code}).`
        },
        requiresConfirmation: true,
        currentBranch: existingManagedBranch
      }
    );
  }

  if (existingManagedBranch && existingManagedBranch.id !== branchId) {
    await tx.branch.update({
      where: { id: existingManagedBranch.id },
      data: {
        managerUserId: null
      }
    });
  }

  if (user.role !== UserRole.BRANCH_MANAGER) {
    await tx.user.update({
      where: { id: user.id },
      data: {
        role: UserRole.BRANCH_MANAGER
      }
    });
  }

  await setPrimaryBranchAssignment(tx, user.id, branchId);

  return {
    ...user,
    role: UserRole.BRANCH_MANAGER,
    previousBranch: existingManagedBranch
  };
};

const resolveBranchManager = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
  manager: NonNullable<BranchCreateInput["manager"]>
) => {
  if (manager.mode === "CREATE_NEW") {
    const user = await createManagerUser(tx, organizationId, branchId, manager);
    return {
      manager: user,
      action: "branch_manager.create",
      previousBranch: null as { id: string; code: string; name: string } | null
    };
  }

  const user = await assignExistingManager(tx, organizationId, branchId, manager);
  return {
    manager: user,
    action: user.previousBranch ? "branch_manager.reassign" : "branch_manager.assign_existing",
    previousBranch: user.previousBranch
  };
};

const getBranchWithManager = async (organizationId: string, branchId: string) => {
  const branch = await prisma.branch.findFirst({
    where: {
      organizationId,
      id: branchId
    },
    include: {
      manager: {
        select: {
          ...activeManagerSelect,
          branchAssignments: {
            where: {
              branchId,
              activeUntil: null
            },
            select: {
              activeFrom: true
            }
          }
        }
      }
    }
  });

  if (!branch) {
    return null;
  }

  const manager = branch.manager
    ? formatManagerSummary(
        branch.manager,
        branch.id,
        branch.manager.branchAssignments[0]?.activeFrom ?? null
      )
    : null;

  return {
    ...branch,
    manager
  };
};

export const branchService = {
  list(auth: AuthContext) {
    return prisma.branch.findMany({
      where: getBranchWhere(auth),
      orderBy: {
        name: "asc"
      }
    });
  },

  async create(auth: AuthContext, input: BranchCreateInput, request: Request) {
    if (input.manager) {
      assertBranchManagerAssignmentPermission(auth);
    }

    const normalized = normalizeBranchCreateInput(input);

    const result = await prisma.$transaction(async (tx) => {
      const existingBranch = await tx.branch.findFirst({
        where: {
          organizationId: auth.organizationId,
          code: normalized.code
        },
        select: { id: true }
      });

      if (existingBranch) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          "Branch code already exists",
          StatusCodes.CONFLICT,
          {
            fieldErrors: {
              code: "This branch code is already in use."
            }
          }
        );
      }

      const branch = await tx.branch.create({
        data: {
          organizationId: auth.organizationId,
          ...normalized
        }
      });

      let managerSummary: BranchManagerSummary | undefined;

      if (input.manager) {
        const managerResult = await resolveBranchManager(tx, auth.organizationId, branch.id, input.manager);

        await tx.branch.update({
          where: { id: branch.id },
          data: {
            managerUserId: managerResult.manager.id
          }
        });

        managerSummary = formatManagerSummary(managerResult.manager, branch.id, new Date());

        await auditService.create(
          {
            organizationId: auth.organizationId,
            branchId: branch.id,
            userId: auth.userId,
            action: managerResult.action,
            entityType: "User",
            entityId: managerResult.manager.id,
            requestId: request.requestContext.requestId,
            ipAddress: request.ip,
            userAgent: request.header("user-agent"),
            afterData: managerSummary,
            metadata: {
              branchId: branch.id,
              branchCode: branch.code,
              managerUserId: managerResult.manager.id,
              previousBranchId: managerResult.previousBranch?.id ?? null,
              actingUserId: auth.userId
            }
          },
          tx
        );
      }

      await auditService.create(
        {
          organizationId: auth.organizationId,
          branchId: branch.id,
          userId: auth.userId,
          action: "branch.create",
          entityType: "Branch",
          entityId: branch.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          afterData: {
            id: branch.id,
            code: branch.code,
            name: branch.name,
            branchType: branch.branchType,
            isActive: branch.status === "ACTIVE"
          },
          metadata: {
            branchId: branch.id,
            branchCode: branch.code,
            managerUserId: managerSummary?.id ?? null,
            actingUserId: auth.userId
          }
        },
        tx
      );

      return {
        branch: {
          id: branch.id,
          code: branch.code,
          name: branch.name,
          branchType: branch.branchType,
          isActive: branch.status === "ACTIVE"
        },
        manager: managerSummary
      };
    });

    return result;
  },

  async assignManager(
    auth: AuthContext,
    branchId: string,
    input: { manager: NonNullable<BranchCreateInput["manager"]> },
    request: Request
  ) {
    assertBranchManagerAssignmentPermission(auth);

    const result = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: {
          organizationId: auth.organizationId,
          id: branchId
        },
        select: {
          id: true,
          code: true,
          name: true,
          managerUserId: true
        }
      });

      if (!branch) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Branch not found", StatusCodes.NOT_FOUND);
      }

      const previousManagerId = branch.managerUserId;

      if (previousManagerId) {
        await clearBranchManager(tx, branch.id);
      }

      const managerResult = await resolveBranchManager(tx, auth.organizationId, branch.id, input.manager);

      await tx.branch.update({
        where: { id: branch.id },
        data: {
          managerUserId: managerResult.manager.id
        }
      });

      const managerSummary = formatManagerSummary(managerResult.manager, branch.id, new Date());

      await auditService.create(
        {
          organizationId: auth.organizationId,
          branchId: branch.id,
          userId: auth.userId,
          action: previousManagerId ? "branch_manager.replace" : managerResult.action,
          entityType: "Branch",
          entityId: branch.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          afterData: managerSummary,
          metadata: {
            branchId: branch.id,
            branchCode: branch.code,
            managerUserId: managerSummary.id,
            previousManagerUserId: previousManagerId,
            previousBranchId: managerResult.previousBranch?.id ?? null,
            actingUserId: auth.userId
          }
        },
        tx
      );

      return managerSummary;
    });

    return result;
  },

  async removeManager(auth: AuthContext, branchId: string, request: Request) {
    assertBranchManagerAssignmentPermission(auth);

    const result = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: {
          organizationId: auth.organizationId,
          id: branchId
        },
        include: {
          manager: {
            select: {
              ...activeManagerSelect,
              branchAssignments: {
                where: {
                  branchId,
                  activeUntil: null
                },
                select: {
                  activeFrom: true
                }
              }
            }
          }
        }
      });

      if (!branch) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Branch not found", StatusCodes.NOT_FOUND);
      }

      if (!branch.manager) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "No branch manager is assigned", StatusCodes.BAD_REQUEST);
      }

      await clearBranchManager(tx, branch.id);

      const managerSummary = formatManagerSummary(
        branch.manager,
        branch.id,
        branch.manager.branchAssignments[0]?.activeFrom ?? null
      );

      await auditService.create(
        {
          organizationId: auth.organizationId,
          branchId: branch.id,
          userId: auth.userId,
          action: "branch_manager.remove",
          entityType: "Branch",
          entityId: branch.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          beforeData: managerSummary,
          metadata: {
            branchId: branch.id,
            branchCode: branch.code,
            managerUserId: managerSummary.id,
            actingUserId: auth.userId
          }
        },
        tx
      );

      return managerSummary;
    });

    return result;
  },

  async deactivateManager(auth: AuthContext, branchId: string, request: Request) {
    assertBranchManagerAssignmentPermission(auth);

    const branch = await this.get(auth, branchId);

    if (!branch.manager) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "No branch manager is assigned", StatusCodes.BAD_REQUEST);
    }

    const updatedManager = await prisma.user.update({
      where: { id: branch.manager.id },
      data: {
        status: UserStatus.SUSPENDED
      },
      select: activeManagerSelect
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId,
      userId: auth.userId,
      action: "branch_manager.deactivate",
      entityType: "User",
      entityId: updatedManager.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      afterData: formatManagerSummary(updatedManager, branchId, branch.manager.assignedAt),
      metadata: {
        branchId,
        branchCode: branch.code,
        managerUserId: updatedManager.id,
        actingUserId: auth.userId
      }
    });

    return formatManagerSummary(updatedManager, branchId, branch.manager.assignedAt);
  },

  async get(auth: AuthContext, branchId: string) {
    if (auth.role !== UserRole.GENERAL_MANAGER) {
      assertBranchAccess(auth, branchId);
    }

    const branch = await getBranchWithManager(auth.organizationId, branchId);

    if (!branch) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Branch not found", StatusCodes.NOT_FOUND);
    }

    return branch;
  },

  async update(
    auth: AuthContext,
    branchId: string,
    input: Record<string, unknown>,
    request: Request
  ) {
    const before = await this.get(auth, branchId);
    const updated = await prisma.branch.update({
      where: { id: before.id },
      data: normalizeBranchUpdateInput(input)
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId,
      userId: auth.userId,
      action: "branch.update",
      entityType: "Branch",
      entityId: branchId,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: before,
      afterData: updated
    });

    return updated;
  },

  async changeStatus(
    auth: AuthContext,
    branchId: string,
    status: BranchStatus,
    request: Request
  ) {
    return this.update(auth, branchId, { status }, request);
  },

  async dashboard(auth: AuthContext, branchId: string) {
    assertBranchAccess(auth, branchId);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todaySales, inventorySummary, payments] = await Promise.all([
      prisma.sale.aggregate({
        where: {
          organizationId: auth.organizationId,
          branchId,
          status: "COMPLETED",
          completedAt: {
            gte: startOfToday
          }
        },
        _sum: {
          totalAmount: true,
          grossProfit: true
        },
        _count: {
          id: true
        }
      }),
      prisma.inventoryBalance.aggregate({
        where: {
          organizationId: auth.organizationId,
          branchId
        },
        _sum: {
          quantityOnHand: true,
          quantityAvailable: true
        },
        _count: {
          id: true
        }
      }),
      prisma.payment.groupBy({
        by: ["paymentMethod"],
        where: {
          organizationId: auth.organizationId,
          branchId,
          status: "COMPLETED",
          receivedAt: {
            gte: startOfToday
          }
        },
        _sum: {
          amount: true
        }
      })
    ]);

    const result = {
      sales: todaySales,
      inventory: inventorySummary,
      payments
    };

    if (auth.role === UserRole.SALES_ATTENDANT) {
      return { ...result, sales: { ...todaySales, _sum: { totalAmount: todaySales._sum.totalAmount } } };
    }

    return result;
  }
};
