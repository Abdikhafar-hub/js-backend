import { Prisma } from "@prisma/client";
import crypto from "crypto";

type DocumentKind = "INVOICE" | "PRO_FORMA" | "CREDIT_NOTE" | "DEBIT_NOTE";

const prefixByKind: Record<DocumentKind, string> = {
  INVOICE: "INV",
  PRO_FORMA: "PRO",
  CREDIT_NOTE: "CRN",
  DEBIT_NOTE: "DBN"
};

const normalizeBranchToken = (branchCode: string | null | undefined) => {
  const token = String(branchCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return token || "ORG";
};

export const buildInvoiceDocumentNumber = ({
  kind,
  branchCode,
  year,
  sequence
}: {
  kind: DocumentKind;
  branchCode: string | null | undefined;
  year: number;
  sequence: number;
}) => `${prefixByKind[kind]}-${normalizeBranchToken(branchCode)}-${year}-${String(sequence).padStart(6, "0")}`;

export const reserveInvoiceDocumentNumber = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    branchId: string | null;
    branchCode: string | null | undefined;
    issuedAt: Date;
    kind: DocumentKind;
  }
) => {
  const year = input.issuedAt.getFullYear();
  const documentType = input.kind;

  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "branchId", "documentType", "year", "nextNumber", "createdAt", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${input.organizationId}, ${input.branchId}, ${documentType}, ${year}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("organizationId", "branchId", "documentType", "year") DO NOTHING
  `;

  const rows = await tx.$queryRaw<Array<{ issued_number: number }>>`
    UPDATE "DocumentSequence"
    SET "nextNumber" = "nextNumber" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = ${input.organizationId}
      AND "branchId" IS NOT DISTINCT FROM ${input.branchId}
      AND "documentType" = ${documentType}
      AND "year" = ${year}
    RETURNING "nextNumber" - 1 AS issued_number
  `;

  const issuedNumber = rows[0]?.issued_number ?? 1;

  return buildInvoiceDocumentNumber({
    kind: input.kind,
    branchCode: input.branchCode,
    year,
    sequence: issuedNumber
  });
};
