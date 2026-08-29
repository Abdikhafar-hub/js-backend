import type { Request } from "express";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { prisma } from "../../lib/prisma.js";
import { auditService } from "../../services/audit.service.js";
import type { AuthContext } from "../../types/auth.js";

export const organizationService = {
  async get(auth: AuthContext) {
    const organization = await prisma.organization.findFirst({
      where: {
        id: auth.organizationId
      },
      include: {
        settingsTyped: true
      }
    });

    if (!organization) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Organization not found", StatusCodes.NOT_FOUND);
    }

    return organization;
  },

  async getSettings(auth: AuthContext) {
    return prisma.organizationSetting.findUnique({ where: { organizationId: auth.organizationId } });
  },

  async updateSettings(auth: AuthContext, input: Record<string, unknown>, request: Request) {
    const before = await prisma.organizationSetting.findUnique({ where: { organizationId: auth.organizationId } });
    const updated = await prisma.organizationSetting.upsert({
      where: { organizationId: auth.organizationId },
      update: input as object,
      create: { organizationId: auth.organizationId, ...(input as object) }
    });
    await auditService.create({
      organizationId: auth.organizationId, userId: auth.userId,
      action: "organization.settings.update", entityType: "OrganizationSetting", entityId: updated.id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: before, afterData: updated
    });
    return updated;
  },

  async update(
    auth: AuthContext,
    input: Record<string, unknown>,
    request: Request
  ) {
    const before = await prisma.organization.findFirst({
      where: {
        id: auth.organizationId
      }
    });

    if (!before) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Organization not found", StatusCodes.NOT_FOUND);
    }

    const updated = await prisma.organization.update({
      where: { id: before.id },
      data: input as object
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "organization.update",
      entityType: "Organization",
      entityId: updated.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: before,
      afterData: updated
    });

    return updated;
  }
};
