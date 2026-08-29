import { Prisma } from "@prisma/client";
import crypto from "crypto";

const normalizeBranchToken = (branchCode: string | null | undefined) => {
  const token = String(branchCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return token || "ORG";
};

const reserveWorkflowNumber = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    branchId: string | null;
    issuedAt: Date;
    documentType: string;
  }
) => {
  const year = input.issuedAt.getFullYear();

  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "branchId", "documentType", "year", "nextNumber", "createdAt", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${input.organizationId}, ${input.branchId}, ${input.documentType}, ${year}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("organizationId", "branchId", "documentType", "year") DO NOTHING
  `;

  const rows = await tx.$queryRaw<Array<{ issued_number: number }>>`
    UPDATE "DocumentSequence"
    SET "nextNumber" = "nextNumber" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = ${input.organizationId}
      AND "branchId" IS NOT DISTINCT FROM ${input.branchId}
      AND "documentType" = ${input.documentType}
      AND "year" = ${year}
    RETURNING "nextNumber" - 1 AS issued_number
  `;

  return {
    year,
    sequence: rows[0]?.issued_number ?? 1
  };
};

export const buildRefundNumber = ({
  branchCode,
  year,
  sequence
}: {
  branchCode: string | null | undefined;
  year: number;
  sequence: number;
}) => `RFD-${normalizeBranchToken(branchCode)}-${year}-${String(sequence).padStart(6, "0")}`;

export const buildReturnNumber = ({
  branchCode,
  year,
  sequence
}: {
  branchCode: string | null | undefined;
  year: number;
  sequence: number;
}) => `RTN-${normalizeBranchToken(branchCode)}-${year}-${String(sequence).padStart(6, "0")}`;

export const reserveRefundNumber = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    branchId: string | null;
    branchCode: string | null | undefined;
    issuedAt: Date;
  }
) => {
  const issued = await reserveWorkflowNumber(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    issuedAt: input.issuedAt,
    documentType: "REFUND"
  });

  return buildRefundNumber({
    branchCode: input.branchCode,
    year: issued.year,
    sequence: issued.sequence
  });
};

export const reserveReturnNumber = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    branchId: string | null;
    branchCode: string | null | undefined;
    issuedAt: Date;
  }
) => {
  const issued = await reserveWorkflowNumber(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    issuedAt: input.issuedAt,
    documentType: "RETURN"
  });

  return buildReturnNumber({
    branchCode: input.branchCode,
    year: issued.year,
    sequence: issued.sequence
  });
};
