import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sanitizePrivateResponseFields } from "../lib/safe-response.js";

type AuditInput = {
  organizationId: string;
  branchId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
};

export const auditService = {
  create: (input: AuditInput, tx?: Prisma.TransactionClient) => {
    const client = tx || prisma;
    return client.auditLog.create({
      data: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        beforeData: input.beforeData
          ? JSON.parse(JSON.stringify(sanitizePrivateResponseFields(input.beforeData)))
          : undefined,
        afterData: input.afterData
          ? JSON.parse(JSON.stringify(sanitizePrivateResponseFields(input.afterData)))
          : undefined,
        metadata: input.metadata
          ? JSON.parse(JSON.stringify(sanitizePrivateResponseFields(input.metadata)))
          : undefined
      }
    });
  }
};
