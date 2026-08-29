import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";

type CustomerBalanceEntry = {
  organizationId: string;
  branchId?: string | null;
  customerId: string;
  amount: number;
  entryType: string;
  referenceType: string;
  referenceId: string;
  notes?: string;
  createdById?: string | null;
};

export const postCustomerBalanceEntry = async (
  tx: Prisma.TransactionClient,
  input: CustomerBalanceEntry
) => {
  const existing = await tx.customerLedgerEntry.findUnique({
    where: {
      customerId_referenceType_referenceId_entryType: {
        customerId: input.customerId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        entryType: input.entryType
      }
    }
  });
  if (existing) return existing;

  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${input.customerId} FOR UPDATE`;
  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId }
  });
  if (!customer) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer not found", StatusCodes.NOT_FOUND);

  const balanceBefore = Number(customer.currentOutstandingBalance);
  const balanceAfter = Math.max(0, balanceBefore + input.amount);
  await tx.customer.update({
    where: { id: customer.id },
    data: { currentOutstandingBalance: balanceAfter }
  });
  return tx.customerLedgerEntry.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId ?? null,
      customerId: customer.id,
      entryType: input.entryType,
      balanceType: "OUTSTANDING",
      amount: input.amount,
      balanceBefore,
      balanceAfter,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes,
      createdById: input.createdById ?? null
    }
  });
};
