import {
  PaymentDirection,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  Prisma,
  RefundMethod,
  UserRole
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import type { AuthContext } from "../../types/auth.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { auditService } from "../../services/audit.service.js";
import { reserveRefundNumber, reserveReturnNumber } from "./refund-numbering.js";

const REFUND_TERMINAL_STATUSES = ["REJECTED", "CANCELLED", "FAILED"];
const RESERVED_REFUND_STATUSES = ["PENDING_APPROVAL", "APPROVED", "PROCESSING", "COMPLETED", "REVIEW_REQUIRED"];
const ACTIVE_RETURN_STATUSES = ["REQUESTED", "UNDER_REVIEW", "INSPECTED", "APPROVED", "COMPLETED"];

const numeric = (value: unknown) => Number(value ?? 0);

const startOfDay = (input: Date) => {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (input: Date) => {
  const date = new Date(input);
  date.setHours(23, 59, 59, 999);
  return date;
};

const startOfMonth = (input: Date) => new Date(input.getFullYear(), input.getMonth(), 1);

const actorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true
} satisfies Prisma.UserSelect;

const refundListInclude = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      phone: true
    }
  },
  branch: { select: { id: true, name: true, code: true } },
  originalSale: {
    select: {
      id: true,
      saleNumber: true,
      amountPaid: true,
      completedAt: true
    }
  },
  originalInvoice: {
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      amountPaid: true,
      amountDue: true,
      status: true
    }
  },
  originalPayment: {
    select: {
      id: true,
      paymentNumber: true,
      paymentMethod: true,
      amount: true,
      reference: true,
      status: true
    }
  },
  returnRequest: {
    select: {
      id: true,
      returnNumber: true,
      status: true,
      completedAt: true
    }
  }
} satisfies Prisma.RefundInclude;

const refundDetailInclude = {
  ...refundListInclude,
  originalSale: {
    include: {
      branch: { select: { id: true, name: true, code: true } },
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true
        }
      },
      attendant: { select: actorSelect },
      payments: {
        where: { direction: PaymentDirection.INCOMING },
        orderBy: { createdAt: "asc" }
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          amountPaid: true,
          amountDue: true,
          status: true
        }
      }
    }
  },
  items: {
    include: {
      saleItem: true,
      productVariant: {
        include: {
          product: true
        }
      }
    }
  },
  returnRequest: {
    include: {
      items: {
        include: {
          saleItem: true,
          productVariant: {
            include: {
              product: true
            }
          }
        }
      }
    }
  }
} satisfies Prisma.RefundInclude;

const ensureRefundReadScope = (auth: AuthContext, query: Record<string, any> = {}) => {
  const scope = buildUserScope(auth);
  const where: Prisma.RefundWhereInput = { organizationId: scope.organizationId };

  if (scope.branchIds) where.branchId = { in: scope.branchIds };
  if (auth.role === "SALES_ATTENDANT") where.requestedById = auth.userId;
  if (query.branchId) {
    assertBranchAccess(auth, String(query.branchId));
    where.branchId = String(query.branchId);
  }

  return where;
};

const ensureManagerApprovalRole = (auth: AuthContext) => {
  if (auth.role !== UserRole.GENERAL_MANAGER) {
    throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only the General Manager can review or process refunds", StatusCodes.FORBIDDEN);
  }
};

const buildRefundMethodSet = (
  sale: {
    customerId: string | null;
    payments: Array<{ paymentMethod: PaymentMethod; status: PaymentRecordStatus; direction: PaymentDirection }>;
  },
  hasInvoice: boolean
) => {
  const supported = new Set<RefundMethod>(["CASH", "BANK_TRANSFER"]);

  if (
    sale.payments.some(
      (payment) =>
        payment.direction === PaymentDirection.INCOMING &&
        payment.status === PaymentRecordStatus.COMPLETED &&
        payment.paymentMethod === PaymentMethod.MPESA
    )
  ) {
    supported.add("MPESA");
  }

  if (sale.customerId) {
    supported.add("STORE_CREDIT");
    if (hasInvoice) supported.add("CREDIT_NOTE");
  }

  return supported;
};

const buildRefundItemSignature = (
  items: Array<{ saleItemId: string; quantity: number | Prisma.Decimal }>
) =>
  items
    .map((item) => `${item.saleItemId}:${numeric(item.quantity).toFixed(4)}`)
    .sort()
    .join("|");

const getActiveRefundAmount = (refund: { amount: number | Prisma.Decimal; approvedAmount?: number | Prisma.Decimal | null }) =>
  numeric(refund.approvedAmount ?? refund.amount);

const getRequesterWriteAccess = (auth: AuthContext, refund: { requestedById: string; branchId: string }) => {
  assertBranchAccess(auth, refund.branchId);

  if (auth.role === "GENERAL_MANAGER") return;
  if (refund.requestedById !== auth.userId) {
    throw new AppError(ERROR_CODES.ACCESS_DENIED, "You can only modify your own refund request", StatusCodes.FORBIDDEN);
  }
};

const loadRefundActors = async (tx: Prisma.TransactionClient, refunds: Array<{
  requestedById: string;
  approvedById?: string | null;
  processedById?: string | null;
  rejectedById?: string | null;
}>) => {
  const ids = Array.from(
    new Set(
      refunds
        .flatMap((refund) => [refund.requestedById, refund.approvedById, refund.processedById, refund.rejectedById])
        .filter((value): value is string => Boolean(value))
    )
  );

  if (ids.length === 0) return new Map<string, { id: string; firstName: string; lastName: string; email: string; role: UserRole }>();

  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: actorSelect
  });

  return new Map(users.map((user) => [user.id, user]));
};

const attachRefundActors = async <T extends {
  requestedById: string;
  approvedById?: string | null;
  processedById?: string | null;
  rejectedById?: string | null;
}>(tx: Prisma.TransactionClient, refunds: T[]) => {
  const actorMap = await loadRefundActors(tx, refunds);

  return refunds.map((refund) => ({
    ...refund,
    requestedBy: actorMap.get(refund.requestedById) ?? null,
    approvedBy: refund.approvedById ? actorMap.get(refund.approvedById) ?? null : null,
    processedBy: refund.processedById ? actorMap.get(refund.processedById) ?? null : null,
    rejectedBy: refund.rejectedById ? actorMap.get(refund.rejectedById) ?? null : null
  }));
};

const getSaleLookupWhere = (auth: AuthContext, search: string) => {
  const scope = buildUserScope(auth);
  const where: Prisma.SaleWhereInput = {
    organizationId: scope.organizationId,
    status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] }
  };

  if (scope.branchIds) where.branchId = { in: scope.branchIds };
  if (auth.role === "SALES_ATTENDANT") where.attendantId = auth.userId;
  if (search) {
    where.OR = [
      { saleNumber: { contains: search, mode: "insensitive" } },
      { customer: { firstName: { contains: search, mode: "insensitive" } } },
      { customer: { lastName: { contains: search, mode: "insensitive" } } },
      { customer: { businessName: { contains: search, mode: "insensitive" } } },
      { customer: { phone: { contains: search } } },
      { invoices: { some: { invoiceNumber: { contains: search, mode: "insensitive" } } } },
      { payments: { some: { reference: { contains: search, mode: "insensitive" } } } },
      { payments: { some: { paymentNumber: { contains: search, mode: "insensitive" } } } }
    ];
  }

  return where;
};

const prepareRefundDraft = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  input: Record<string, any>,
  options: {
    excludeRefundId?: string;
    excludeReturnRequestId?: string;
  } = {}
) => {
  const scope = buildUserScope(auth);
  const sale = await tx.sale.findFirst({
    where: {
      id: String(input.saleId),
      organizationId: scope.organizationId,
      ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
      ...(auth.role === "SALES_ATTENDANT" ? { attendantId: auth.userId } : {})
    },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true
        }
      },
      attendant: { select: actorSelect },
      items: {
        include: {
          productVariant: {
            include: { product: true }
          }
        }
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          amountPaid: true,
          amountDue: true,
          status: true
        }
      },
      payments: {
        where: {
          direction: PaymentDirection.INCOMING,
          status: PaymentRecordStatus.COMPLETED
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!sale) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Original sale not found", StatusCodes.NOT_FOUND);
  }

  assertBranchAccess(auth, sale.branchId);

  if (!["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"].includes(sale.status)) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Only completed sales can be refunded", StatusCodes.BAD_REQUEST);
  }

  if (sale.payments.length === 0 || numeric(sale.amountPaid) <= 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "No completed payment is available to refund", StatusCodes.BAD_REQUEST);
  }

  const invoice =
    input.originalInvoiceId != null
      ? sale.invoices.find((entry) => entry.id === input.originalInvoiceId) ?? null
      : sale.invoices[0] ?? null;
  if (input.originalInvoiceId && !invoice) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Selected invoice does not belong to the original sale", StatusCodes.BAD_REQUEST);
  }

  const originalPayment =
    input.originalPaymentId != null
      ? sale.payments.find((entry) => entry.id === input.originalPaymentId) ?? null
      : sale.payments[0] ?? null;
  if (input.originalPaymentId && !originalPayment) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Selected payment does not belong to the original sale", StatusCodes.BAD_REQUEST);
  }

  const supportedMethods = buildRefundMethodSet(sale, Boolean(invoice));
  if (!supportedMethods.has(input.refundMethod as RefundMethod)) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Refund method is not supported for the selected transaction", StatusCodes.BAD_REQUEST);
  }

  const saleItemIds = sale.items.map((item) => item.id);
  const [activeReturnItems, reservedRefunds] = await Promise.all([
    tx.returnRequestItem.findMany({
      where: {
        saleItemId: { in: saleItemIds },
        returnRequest: {
          organizationId: auth.organizationId,
          status: { in: ACTIVE_RETURN_STATUSES as any },
          ...(options.excludeReturnRequestId ? { id: { not: options.excludeReturnRequestId } } : {})
        }
      },
      select: {
        saleItemId: true,
        quantity: true
      }
    }),
    tx.refund.findMany({
      where: {
        organizationId: auth.organizationId,
        originalSaleId: sale.id,
        status: { in: RESERVED_REFUND_STATUSES as any },
        ...(options.excludeRefundId ? { id: { not: options.excludeRefundId } } : {})
      },
      include: {
        items: {
          select: {
            saleItemId: true,
            quantity: true
          }
        }
      }
    })
  ]);

  const returnQtyMap = new Map<string, number>();
  for (const item of activeReturnItems) {
    returnQtyMap.set(item.saleItemId, numeric(returnQtyMap.get(item.saleItemId)) + numeric(item.quantity));
  }

  const refundQtyMap = new Map<string, number>();
  for (const refund of reservedRefunds) {
    for (const item of refund.items) {
      refundQtyMap.set(item.saleItemId, numeric(refundQtyMap.get(item.saleItemId)) + numeric(item.quantity));
    }
  }

  const selectedItems = Array.isArray(input.items) ? input.items : [];
  if (selectedItems.length === 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Select at least one line item to refund", StatusCodes.BAD_REQUEST);
  }

  const preparedItems = selectedItems.map((requested: Record<string, any>) => {
    const saleItem = sale.items.find((item) => item.id === String(requested.saleItemId));
    if (!saleItem) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Refund line does not belong to the original sale", StatusCodes.BAD_REQUEST);
    }

    const originalQty = numeric(saleItem.quantity);
    const activeReturnQty = numeric(returnQtyMap.get(saleItem.id));
    const activeRefundQty = numeric(refundQtyMap.get(saleItem.id));
    const remainingQty = Math.max(0, originalQty - Math.max(activeReturnQty, activeRefundQty));
    const requestedQty = numeric(requested.quantity);

    if (requestedQty <= 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Refund quantities must be greater than zero", StatusCodes.BAD_REQUEST);
    }

    if (requestedQty > remainingQty + 0.0001) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `Requested quantity exceeds the ${remainingQty} units still eligible for ${saleItem.productNameSnapshot}`,
        StatusCodes.BAD_REQUEST
      );
    }

    const eligibleUnitAmount = originalQty > 0 ? numeric(saleItem.lineTotal) / originalQty : 0;
    const lineAmount = Number((eligibleUnitAmount * requestedQty).toFixed(2));

    return {
      saleItemId: saleItem.id,
      productVariantId: saleItem.productVariantId,
      quantity: requestedQty,
      originalQuantity: originalQty,
      previouslyReturnedQuantity: activeReturnQty,
      previouslyRefundedQuantity: activeRefundQty,
      remainingRefundableQuantity: remainingQty,
      originalUnitPrice: numeric(saleItem.originalUnitPrice || saleItem.unitPrice),
      lineDiscountAmount: numeric(saleItem.discountAmount),
      eligibleLineAmount: lineAmount,
      requestedLineAmount: lineAmount,
      reason: requested.reason?.trim() || null,
      condition: requested.condition ?? "SEALED",
      restockDisposition: requested.restockDisposition ?? null,
      saleItem,
      productVariant: saleItem.productVariant
    };
  });

  const eligibleAmount = Number(preparedItems.reduce((sum, item) => sum + item.eligibleLineAmount, 0).toFixed(2));
  const requestedAmount = Number(
    (input.requestedAmount != null ? numeric(input.requestedAmount) : eligibleAmount).toFixed(2)
  );

  if (requestedAmount <= 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Requested refund must be greater than zero", StatusCodes.BAD_REQUEST);
  }

  if (requestedAmount > eligibleAmount + 0.01) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Requested refund cannot exceed the eligible amount", StatusCodes.BAD_REQUEST);
  }

  const priorReservedAmount = reservedRefunds.reduce((sum, refund) => sum + getActiveRefundAmount(refund), 0);
  if (priorReservedAmount + requestedAmount > numeric(sale.amountPaid) + 0.01) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Refunds cannot exceed the original paid amount", StatusCodes.BAD_REQUEST);
  }

  const signature = buildRefundItemSignature(preparedItems);
  const duplicate = reservedRefunds.some(
    (refund) =>
      Math.abs(getActiveRefundAmount(refund) - requestedAmount) < 0.01 &&
      refund.items.length === preparedItems.length &&
      buildRefundItemSignature(refund.items) === signature
  );
  if (duplicate) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "A matching refund request already exists for these items", StatusCodes.CONFLICT);
  }

  if (input.refundType === "FULL_ORDER") {
    const allRemainingSelected = sale.items.every((item) => {
      const activeReturnQty = numeric(returnQtyMap.get(item.id));
      const activeRefundQty = numeric(refundQtyMap.get(item.id));
      const remainingQty = Math.max(0, numeric(item.quantity) - Math.max(activeReturnQty, activeRefundQty));
      const selected = preparedItems.find((entry) => entry.saleItemId === item.id);
      return Math.abs(numeric(selected?.quantity ?? 0) - remainingQty) < 0.0001;
    });
    if (!allRemainingSelected) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Full order refunds must select every remaining refundable quantity", StatusCodes.BAD_REQUEST);
    }
  }

  return {
    sale,
    invoice,
    originalPayment,
    supportedMethods: Array.from(supportedMethods),
    preparedItems,
    eligibleAmount,
    requestedAmount
  };
};

const syncRefundReturnRequest = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  refund: {
    id: string;
    returnRequestId: string | null;
    method: RefundMethod;
    reason: string;
    branchId: string;
    customerId: string | null;
    originalSaleId: string;
  },
  prepared: Awaited<ReturnType<typeof prepareRefundDraft>>
) => {
  const now = new Date();
  const returnItemCreate = prepared.preparedItems.map((item) => ({
    saleItemId: item.saleItemId,
    productVariantId: item.productVariantId,
    quantity: item.quantity,
    originalUnitPrice: item.originalUnitPrice,
    eligibleValue: item.eligibleLineAmount,
    condition: item.condition,
    disposition: item.restockDisposition
  }));

  if (refund.returnRequestId) {
    const current = await tx.returnRequest.findUnique({
      where: { id: refund.returnRequestId },
      include: { items: true }
    });
    if (!current) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Linked return request not found", StatusCodes.NOT_FOUND);
    }
    if (["COMPLETED", "REJECTED"].includes(current.status)) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Linked return request can no longer be corrected", StatusCodes.CONFLICT);
    }

    await tx.returnRequestItem.deleteMany({ where: { returnRequestId: current.id } });
    return tx.returnRequest.update({
      where: { id: current.id },
      data: {
        status: "REQUESTED",
        reason: refund.reason,
        resolution: "REFUND",
        requestedRefundMethod: refund.method,
        reviewedById: null,
        inspectedById: null,
        approvedById: null,
        rejectedById: null,
        reviewNotes: null,
        inspectionNotes: null,
        rejectionReason: null,
        reviewedAt: null,
        inspectedAt: null,
        approvedAt: null,
        rejectedAt: null,
        completedAt: null,
        items: {
          create: returnItemCreate
        }
      }
    });
  }

  const returnNumber = await reserveReturnNumber(tx, {
    organizationId: auth.organizationId,
    branchId: prepared.sale.branchId,
    branchCode: prepared.sale.branch.code,
    issuedAt: now
  });

  return tx.returnRequest.create({
    data: {
      organizationId: auth.organizationId,
      branchId: prepared.sale.branchId,
      returnNumber,
      saleId: prepared.sale.id,
      customerId: prepared.sale.customerId,
      status: "REQUESTED",
      reason: refund.reason,
      resolution: "REFUND",
      requestedRefundMethod: refund.method,
      requestedById: auth.userId,
      requestedAt: now,
      items: {
        create: returnItemCreate
      }
    }
  });
};

const getRefundWithScope = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  id: string,
  include: Prisma.RefundInclude = refundDetailInclude
) => {
  const scope = buildUserScope(auth);
  const refund = await tx.refund.findFirst({
    where: {
      id,
      organizationId: scope.organizationId,
      ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
      ...(auth.role === "SALES_ATTENDANT" ? { requestedById: auth.userId } : {})
    },
    include
  });

  if (!refund) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Refund not found", StatusCodes.NOT_FOUND);
  }

  return refund;
};

const hydrateRefundDetail = async (auth: AuthContext, id: string) => {
  return prisma.$transaction(async (tx) => {
    const refund = await getRefundWithScope(tx, auth, id, refundDetailInclude);
    const [withActors] = await attachRefundActors(tx, [refund]);
    const refundPayments = await tx.payment.findMany({
      where: {
        organizationId: auth.organizationId,
        idempotencyKey: `refund:${refund.id}`
      },
      orderBy: { createdAt: "desc" }
    });
    const customerLedgerImpact =
      refund.customerId == null
        ? []
        : await tx.customerLedgerEntry.findMany({
            where: {
              organizationId: auth.organizationId,
              referenceType: "Refund",
              referenceId: refund.id
            },
            orderBy: { createdAt: "desc" }
          });
    const auditHistory = await tx.auditLog.findMany({
      where: {
        organizationId: auth.organizationId,
        OR: [
          { entityType: "Refund", entityId: refund.id },
          ...(refund.returnRequestId ? [{ entityType: "ReturnRequest", entityId: refund.returnRequestId }] : [])
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return {
      ...withActors,
      paymentEntries: refundPayments,
      customerLedgerImpact,
      auditHistory
    };
  });
};

export const refundWorkflowService = {
  async refundSummary(auth: AuthContext, query: Record<string, any>) {
    const baseWhere = ensureRefundReadScope(auth, query);
    const now = new Date();
    const mtdStart = startOfMonth(now);
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const settings = await prisma.organizationSetting.findUnique({ where: { organizationId: auth.organizationId } });
    const highValueThreshold = Number(settings?.maximumGeneralManagerRefund ?? settings?.maximumBranchManagerRefund ?? 0) || 10000;

    const [refunds, completedToday, salesCompletedMtd] = await Promise.all([
      prisma.refund.findMany({
        where: baseWhere,
        select: {
          status: true,
          amount: true,
          approvedAmount: true,
          requestedAt: true,
          approvedAt: true,
          completedAt: true
        }
      }),
      prisma.refund.count({
        where: {
          ...baseWhere,
          status: "COMPLETED",
          completedAt: { gte: todayStart, lte: todayEnd }
        }
      }),
      prisma.sale.count({
        where: {
          organizationId: auth.organizationId,
          ...(auth.role === "GENERAL_MANAGER" || !auth.branchIds.length ? {} : { branchId: { in: auth.branchIds } }),
          ...(query.branchId ? { branchId: String(query.branchId) } : {}),
          status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] },
          completedAt: { gte: mtdStart, lte: todayEnd }
        }
      })
    ]);

    const amountMtd = refunds
      .filter((refund) => refund.status === "COMPLETED" && refund.completedAt && refund.completedAt >= mtdStart)
      .reduce((sum, refund) => sum + getActiveRefundAmount(refund), 0);
    const approvalDurations = refunds
      .filter((refund) => refund.approvedAt)
      .map((refund) => new Date(refund.approvedAt!).getTime() - new Date(refund.requestedAt).getTime())
      .filter((value) => value >= 0);

    return {
      pendingApproval: refunds.filter((refund) => refund.status === "PENDING_APPROVAL").length,
      approvedForProcessing: refunds.filter((refund) => refund.status === "APPROVED").length,
      processing: refunds.filter((refund) => refund.status === "PROCESSING").length,
      completedToday,
      failedRefunds: refunds.filter((refund) => refund.status === "FAILED").length,
      refundAmountMtd: Number(amountMtd.toFixed(2)),
      averageApprovalTimeHours:
        approvalDurations.length > 0
          ? Number((approvalDurations.reduce((sum, value) => sum + value, 0) / approvalDurations.length / 3_600_000).toFixed(2))
          : 0,
      refundRate:
        salesCompletedMtd > 0
          ? Number(((refunds.filter((refund) => refund.status === "COMPLETED").length / salesCompletedMtd) * 100).toFixed(2))
          : 0,
      highValueRequests: refunds.filter((refund) => getActiveRefundAmount(refund) >= highValueThreshold).length,
      highValueThreshold
    };
  },

  async lookupRefundSales(auth: AuthContext, query: Record<string, any>) {
    const search = String(query.search ?? "").trim();
    if (!search) return [];

    const candidates = await prisma.sale.findMany({
      where: getSaleLookupWhere(auth, search),
      include: {
        branch: { select: { id: true, name: true, code: true } },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            businessName: true,
            phone: true
          }
        },
        attendant: { select: actorSelect },
        items: {
          include: {
            productVariant: {
              include: { product: true }
            }
          }
        },
        payments: {
          where: {
            direction: PaymentDirection.INCOMING,
            status: PaymentRecordStatus.COMPLETED
          },
          orderBy: { createdAt: "asc" }
        },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            totalAmount: true,
            amountPaid: true,
            amountDue: true,
            status: true
          }
        }
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: 12
    });

    const [returnItems, refunds] = await Promise.all([
      prisma.returnRequestItem.findMany({
        where: {
          saleItemId: { in: candidates.flatMap((sale) => sale.items.map((item) => item.id)) },
          returnRequest: {
            organizationId: auth.organizationId,
            status: { in: ACTIVE_RETURN_STATUSES as any }
          }
        },
        select: { saleItemId: true, quantity: true }
      }),
      prisma.refund.findMany({
        where: {
          organizationId: auth.organizationId,
          originalSaleId: { in: candidates.map((sale) => sale.id) },
          status: { notIn: REFUND_TERMINAL_STATUSES as any }
        },
        include: {
          items: {
            select: { saleItemId: true, quantity: true }
          }
        }
      })
    ]);

    const returnQtyMap = new Map<string, number>();
    for (const item of returnItems) {
      returnQtyMap.set(item.saleItemId, numeric(returnQtyMap.get(item.saleItemId)) + numeric(item.quantity));
    }

    const refundsBySale = new Map<string, Array<(typeof refunds)[number]>>();
    for (const refund of refunds) {
      const collection = refundsBySale.get(refund.originalSaleId) ?? [];
      collection.push(refund);
      refundsBySale.set(refund.originalSaleId, collection);
    }

    return candidates.map((sale) => {
      const saleRefunds = refundsBySale.get(sale.id) ?? [];
      const refundQtyMap = new Map<string, number>();
      for (const refund of saleRefunds) {
        for (const item of refund.items) {
          refundQtyMap.set(item.saleItemId, numeric(refundQtyMap.get(item.saleItemId)) + numeric(item.quantity));
        }
      }

      const eligibleItems = sale.items
        .map((item) => {
          const activeReturnQty = numeric(returnQtyMap.get(item.id));
          const activeRefundQty = numeric(refundQtyMap.get(item.id));
          const remainingQty = Math.max(0, numeric(item.quantity) - Math.max(activeReturnQty, activeRefundQty));
          const eligibleUnitAmount = numeric(item.quantity) > 0 ? numeric(item.lineTotal) / numeric(item.quantity) : 0;
          return {
            saleItemId: item.id,
            productVariantId: item.productVariantId,
            productName: item.productNameSnapshot,
            variantName: item.variantSnapshot,
            sku: item.skuSnapshot,
            originalQuantity: numeric(item.quantity),
            previouslyReturnedQuantity: activeReturnQty,
            previouslyRefundedQuantity: activeRefundQty,
            remainingRefundableQuantity: remainingQty,
            originalUnitPrice: numeric(item.originalUnitPrice || item.unitPrice),
            eligibleLineAmount: Number((remainingQty * eligibleUnitAmount).toFixed(2))
          };
        })
        .filter((item) => item.remainingRefundableQuantity > 0);

      return {
        id: sale.id,
        saleNumber: sale.saleNumber,
        saleDate: sale.completedAt ?? sale.createdAt,
        branch: sale.branch,
        customer: sale.customer,
        salesperson: sale.attendant,
        invoices: sale.invoices,
        payments: sale.payments,
        supportedMethods: Array.from(buildRefundMethodSet(sale, sale.invoices.length > 0)),
        amountPaid: numeric(sale.amountPaid),
        remainingRefundableAmount: Number(
          Math.max(
            0,
            numeric(sale.amountPaid) - saleRefunds.reduce((sum, refund) => sum + getActiveRefundAmount(refund), 0)
          ).toFixed(2)
        ),
        previousRefunds: saleRefunds.length,
        eligibleItems
      };
    });
  },

  async listRefunds(auth: AuthContext, query: Record<string, any>) {
    const where = ensureRefundReadScope(auth, query);

    if (query.status) where.status = String(query.status) as any;
    if (query.method) where.method = String(query.method) as any;
    if (query.failedOnly === "true") where.status = "FAILED";
    if (query.highValueOnly === "true") where.amount = { gte: Number(query.highValueAmount ?? 10000) };
    if (query.dateFrom || query.dateTo) {
      where.requestedAt = {
        ...(query.dateFrom ? { gte: startOfDay(new Date(String(query.dateFrom))) } : {}),
        ...(query.dateTo ? { lte: endOfDay(new Date(String(query.dateTo))) } : {})
      };
    }

    const search = String(query.search ?? "").trim();
    if (search) {
      where.OR = [
        { refundNumber: { contains: search, mode: "insensitive" } },
        { reason: { contains: search, mode: "insensitive" } },
        { originalSale: { saleNumber: { contains: search, mode: "insensitive" } } },
        { originalInvoice: { invoiceNumber: { contains: search, mode: "insensitive" } } },
        { originalPayment: { reference: { contains: search, mode: "insensitive" } } },
        { customer: { firstName: { contains: search, mode: "insensitive" } } },
        { customer: { lastName: { contains: search, mode: "insensitive" } } },
        { customer: { businessName: { contains: search, mode: "insensitive" } } },
        { customer: { phone: { contains: search } } }
      ];
    }

    const refunds = await prisma.refund.findMany({
      where,
      include: refundListInclude,
      orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }]
    });

    return prisma.$transaction(async (tx) => attachRefundActors(tx, refunds));
  },

  async createRefundRequest(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const prepared = await prepareRefundDraft(tx, auth, input);
      const refund = await tx.refund.create({
        data: {
          organizationId: auth.organizationId,
          branchId: prepared.sale.branchId,
          refundNumber: null,
          originalSaleId: prepared.sale.id,
          originalInvoiceId: prepared.invoice?.id ?? null,
          originalPaymentId: prepared.originalPayment?.id ?? null,
          customerId: prepared.sale.customerId,
          amount: prepared.requestedAmount,
          eligibleAmount: prepared.eligibleAmount,
          approvedAmount: null,
          method: input.refundMethod,
          refundType: input.refundType,
          status: "DRAFT",
          reason: String(input.reason).trim(),
          detailedReason: String(input.detailedReason).trim(),
          requestedById: auth.userId,
          items: {
            create: prepared.preparedItems.map((item) => ({
              saleItemId: item.saleItemId,
              productVariantId: item.productVariantId,
              quantity: item.quantity,
              originalQuantity: item.originalQuantity,
              previouslyReturnedQuantity: item.previouslyReturnedQuantity,
              previouslyRefundedQuantity: item.previouslyRefundedQuantity,
              remainingRefundableQuantity: item.remainingRefundableQuantity,
              originalUnitPrice: item.originalUnitPrice,
              lineDiscountAmount: item.lineDiscountAmount,
              eligibleLineAmount: item.eligibleLineAmount,
              requestedLineAmount: item.requestedLineAmount,
              reason: item.reason,
              condition: item.condition,
              restockDisposition: item.restockDisposition
            }))
          }
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: refund.branchId,
        userId: auth.userId,
        action: "refund.draft",
        entityType: "Refund",
        entityId: refund.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: refund
      }, tx);

      return hydrateRefundDetail(auth, refund.id);
    });
  },

  async updateRefundRequest(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const current = await getRefundWithScope(tx, auth, id, {
        items: true
      });
      getRequesterWriteAccess(auth, current);
      if (!["DRAFT", "REVIEW_REQUIRED"].includes(current.status)) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only draft or returned refunds can be edited", StatusCodes.CONFLICT);
      }

      const prepared = await prepareRefundDraft(tx, auth, {
        ...input,
        saleId: current.originalSaleId
      }, {
        excludeRefundId: current.id,
        excludeReturnRequestId: current.returnRequestId ?? undefined
      });

      await tx.refundItem.deleteMany({ where: { refundId: current.id } });
      const updated = await tx.refund.update({
        where: { id: current.id },
        data: {
          originalInvoiceId: prepared.invoice?.id ?? null,
          originalPaymentId: prepared.originalPayment?.id ?? null,
          amount: prepared.requestedAmount,
          eligibleAmount: prepared.eligibleAmount,
          approvedAmount: null,
          method: input.refundMethod,
          refundType: input.refundType,
          reason: String(input.reason).trim(),
          detailedReason: String(input.detailedReason).trim(),
          correctionInstructions: current.status === "REVIEW_REQUIRED" ? null : current.correctionInstructions,
          items: {
            create: prepared.preparedItems.map((item) => ({
              saleItemId: item.saleItemId,
              productVariantId: item.productVariantId,
              quantity: item.quantity,
              originalQuantity: item.originalQuantity,
              previouslyReturnedQuantity: item.previouslyReturnedQuantity,
              previouslyRefundedQuantity: item.previouslyRefundedQuantity,
              remainingRefundableQuantity: item.remainingRefundableQuantity,
              originalUnitPrice: item.originalUnitPrice,
              lineDiscountAmount: item.lineDiscountAmount,
              eligibleLineAmount: item.eligibleLineAmount,
              requestedLineAmount: item.requestedLineAmount,
              reason: item.reason,
              condition: item.condition,
              restockDisposition: item.restockDisposition
            }))
          }
        }
      });

      if (current.returnRequestId) {
        await syncRefundReturnRequest(tx, auth, updated, prepared);
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: current.branchId,
        userId: auth.userId,
        action: "refund.update",
        entityType: "Refund",
        entityId: current.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: current,
        afterData: updated
      }, tx);

      return hydrateRefundDetail(auth, current.id);
    });
  },

  async submitRefundRequest(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const current = await getRefundWithScope(tx, auth, id, {
        items: true
      });
      getRequesterWriteAccess(auth, current);
      if (!["DRAFT", "REVIEW_REQUIRED"].includes(current.status)) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only draft or returned refunds can be submitted", StatusCodes.CONFLICT);
      }

      const prepared = await prepareRefundDraft(
        tx,
        auth,
        {
          saleId: current.originalSaleId,
          originalInvoiceId: current.originalInvoiceId,
          originalPaymentId: current.originalPaymentId,
          refundMethod: current.method,
          refundType: current.refundType,
          reason: current.reason,
          detailedReason: current.detailedReason ?? current.reason,
          requestedAmount: current.amount,
          items: current.items.map((item) => ({
            saleItemId: item.saleItemId,
            quantity: item.quantity,
            reason: item.reason,
            condition: item.condition,
            restockDisposition: item.restockDisposition
          }))
        },
        {
          excludeRefundId: current.id,
          excludeReturnRequestId: current.returnRequestId ?? undefined
        }
      );

      const issuedAt = new Date();
      const returnRequest = await syncRefundReturnRequest(tx, auth, current, prepared);
      const refundNumber =
        current.refundNumber ??
        (await reserveRefundNumber(tx, {
          organizationId: auth.organizationId,
          branchId: current.branchId,
          branchCode: prepared.sale.branch.code,
          issuedAt
        }));

      const updated = await tx.refund.update({
        where: { id: current.id },
        data: {
          refundNumber,
          returnRequestId: returnRequest.id,
          originalInvoiceId: prepared.invoice?.id ?? null,
          originalPaymentId: prepared.originalPayment?.id ?? null,
          amount: prepared.requestedAmount,
          eligibleAmount: prepared.eligibleAmount,
          status: "PENDING_APPROVAL",
          submittedAt: issuedAt,
          correctionInstructions: null,
          rejectionReason: null,
          cancellationReason: null
        }
      });

      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          branchId: updated.branchId,
          role: UserRole.GENERAL_MANAGER,
          type: "REFUND_PENDING_APPROVAL",
          title: `Refund ${refundNumber} awaiting approval`,
          message: `A refund request for ${prepared.sale.saleNumber} is pending General Manager review.`,
          metadata: {
            refundId: updated.id,
            refundNumber,
            branchId: updated.branchId,
            saleId: prepared.sale.id
          }
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: current.branchId,
        userId: auth.userId,
        action: "refund.submit",
        entityType: "Refund",
        entityId: current.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: current,
        afterData: updated
      }, tx);

      return hydrateRefundDetail(auth, current.id);
    });
  },

  async getRefund(auth: AuthContext, id: string) {
    return hydrateRefundDetail(auth, id);
  },

  async approveRefund(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    ensureManagerApprovalRole(auth);

    return prisma.$transaction(async (tx) => {
      const refund = await getRefundWithScope(tx, auth, id, {
        ...refundDetailInclude
      });

      if (refund.status !== "PENDING_APPROVAL") {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Refund is not pending approval", StatusCodes.CONFLICT);
      }
      if (refund.requestedById === auth.userId) {
        throw new AppError(ERROR_CODES.ACCESS_DENIED, "A requester cannot approve their own refund", StatusCodes.FORBIDDEN);
      }

      const approvedAmount = Number((input.approvedAmount != null ? numeric(input.approvedAmount) : numeric(refund.amount)).toFixed(2));
      if (approvedAmount <= 0) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Approved amount must be greater than zero", StatusCodes.BAD_REQUEST);
      }
      if (approvedAmount > numeric(refund.eligibleAmount) + 0.01) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Approved amount cannot exceed the eligible amount", StatusCodes.BAD_REQUEST);
      }

      const previouslyApproved = await tx.refund.findMany({
        where: {
          organizationId: auth.organizationId,
          originalSaleId: refund.originalSaleId,
          id: { not: refund.id },
          status: { in: ["APPROVED", "PROCESSING", "COMPLETED"] }
        },
        select: {
          amount: true,
          approvedAmount: true
        }
      });
      if (
        previouslyApproved.reduce((sum, entry) => sum + getActiveRefundAmount(entry), 0) + approvedAmount >
        numeric(refund.originalSale.amountPaid) + 0.01
      ) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Approvals would exceed the original amount paid", StatusCodes.BAD_REQUEST);
      }

      const settings = await tx.organizationSetting.findUnique({ where: { organizationId: auth.organizationId } });
      const gmAuthority = numeric(settings?.maximumGeneralManagerRefund);
      if (gmAuthority > 0 && approvedAmount > gmAuthority + 0.01) {
        const reviewRequired = await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: "REVIEW_REQUIRED",
            approvedAmount,
            correctionInstructions: "Approved amount exceeds the configured General Manager authority threshold."
          }
        });

        await auditService.create({
          organizationId: auth.organizationId,
          branchId: refund.branchId,
          userId: auth.userId,
          action: "refund.review_required",
          entityType: "Refund",
          entityId: refund.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          beforeData: refund,
          afterData: reviewRequired
        }, tx);

        return reviewRequired;
      }

      const originalSaleWithPayments = refund.originalSale as typeof refund.originalSale & {
        payments: Array<{
          id: string;
          status: PaymentRecordStatus;
          amount: Prisma.Decimal;
        }>;
      };
      const originalPayment =
        refund.originalPayment ??
        originalSaleWithPayments.payments.find(
          (payment) =>
            payment.status === PaymentRecordStatus.COMPLETED &&
            numeric(payment.amount) >= approvedAmount
        ) ??
        originalSaleWithPayments.payments.find((payment) => payment.status === PaymentRecordStatus.COMPLETED) ??
        null;

      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: "APPROVED",
          amount: approvedAmount,
          approvedAmount,
          approvedById: auth.userId,
          approvedAt: new Date(),
          approvalNote: input.note?.trim() || null,
          correctionInstructions: null,
          originalPaymentId: originalPayment?.id ?? refund.originalPaymentId ?? null
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: refund.branchId,
        userId: auth.userId,
        action: "refund.approve",
        entityType: "Refund",
        entityId: refund.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: refund,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async returnRefundForCorrection(auth: AuthContext, id: string, instructions: string, request: Request) {
    ensureManagerApprovalRole(auth);

    return prisma.$transaction(async (tx) => {
      const refund = await getRefundWithScope(tx, auth, id, {
        returnRequest: true
      });

      if (!["PENDING_APPROVAL", "REVIEW_REQUIRED"].includes(refund.status)) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Refund cannot be returned for correction", StatusCodes.CONFLICT);
      }

      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: "REVIEW_REQUIRED",
          correctionInstructions: instructions.trim(),
          approvedById: null,
          approvedAt: null,
          approvalNote: null
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: refund.branchId,
        userId: auth.userId,
        action: "refund.return_for_correction",
        entityType: "Refund",
        entityId: refund.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: refund,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async rejectRefund(auth: AuthContext, id: string, reason: string, request: Request) {
    ensureManagerApprovalRole(auth);

    return prisma.$transaction(async (tx) => {
      const refund = await getRefundWithScope(tx, auth, id, {
        returnRequest: true
      });

      if (!["PENDING_APPROVAL", "REVIEW_REQUIRED"].includes(refund.status)) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Refund can no longer be rejected", StatusCodes.CONFLICT);
      }

      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: "REJECTED",
          rejectedById: auth.userId,
          rejectedAt: new Date(),
          rejectionReason: reason.trim()
        }
      });

      if (refund.returnRequestId) {
        await tx.returnRequest.updateMany({
          where: {
            id: refund.returnRequestId,
            status: { in: ["REQUESTED", "UNDER_REVIEW", "INSPECTED", "APPROVED"] }
          },
          data: {
            status: "REJECTED",
            rejectedById: auth.userId,
            rejectedAt: new Date(),
            rejectionReason: reason.trim()
          }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: refund.branchId,
        userId: auth.userId,
        action: "refund.reject",
        entityType: "Refund",
        entityId: refund.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: refund,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async cancelRefund(auth: AuthContext, id: string, reason: string | undefined, request: Request) {
    return prisma.$transaction(async (tx) => {
      const refund = await getRefundWithScope(tx, auth, id, {
        returnRequest: true
      });

      assertBranchAccess(auth, refund.branchId);

      const requesterOwned = refund.requestedById === auth.userId;
      const gm = auth.role === UserRole.GENERAL_MANAGER;
      if (!gm && !requesterOwned) {
        throw new AppError(ERROR_CODES.ACCESS_DENIED, "You can only cancel your own refund request", StatusCodes.FORBIDDEN);
      }

      const cancellableStatuses = gm
        ? ["DRAFT", "PENDING_APPROVAL", "REVIEW_REQUIRED", "APPROVED"]
        : ["DRAFT", "PENDING_APPROVAL", "REVIEW_REQUIRED"];
      if (!cancellableStatuses.includes(refund.status)) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Refund can no longer be cancelled", StatusCodes.CONFLICT);
      }

      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: reason?.trim() || null
        }
      });

      if (refund.returnRequestId) {
        await tx.returnRequest.updateMany({
          where: {
            id: refund.returnRequestId,
            status: { in: ["REQUESTED", "UNDER_REVIEW", "INSPECTED", "APPROVED"] }
          },
          data: {
            status: "REJECTED",
            rejectedById: auth.userId,
            rejectedAt: new Date(),
            rejectionReason: reason?.trim() || "Refund request cancelled"
          }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: refund.branchId,
        userId: auth.userId,
        action: "refund.cancel",
        entityType: "Refund",
        entityId: refund.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: refund,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async processRefund(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    ensureManagerApprovalRole(auth);

    return prisma.$transaction(async (tx) => {
      const refund = await getRefundWithScope(tx, auth, id, {
        customer: true,
        originalSale: true,
        originalInvoice: true,
        returnRequest: true
      });

      if (refund.status !== "APPROVED") {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only an approved refund can be processed", StatusCodes.CONFLICT);
      }
      if (!refund.returnRequest || refund.returnRequest.status !== "COMPLETED") {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Inventory disposition must complete before refund processing", StatusCodes.CONFLICT);
      }

      const amountToProcess = getActiveRefundAmount(refund);

      if (refund.method === "MPESA") {
        const processing = await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: "PROCESSING",
            processedById: auth.userId,
            processedAt: new Date(),
            providerReference: input.providerReference ?? null,
            providerStatus: "PENDING_CONFIRMATION"
          }
        });

        await auditService.create({
          organizationId: auth.organizationId,
          branchId: refund.branchId,
          userId: auth.userId,
          action: "refund.mpesa_processing",
          entityType: "Refund",
          entityId: refund.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          beforeData: refund,
          afterData: processing
        }, tx);

        return processing;
      }

      let shiftId: string | null = null;
      if (refund.method === "CASH") {
        const shift = await tx.shift.findFirst({
          where: { organizationId: auth.organizationId, branchId: refund.branchId, userId: auth.userId, status: "OPEN" }
        });
        if (!shift) {
          throw new AppError(ERROR_CODES.SHIFT_NOT_OPEN, "Cash refund requires an open shift", StatusCodes.CONFLICT);
        }
        shiftId = shift.id;
        await tx.shiftCashMovement.create({
          data: {
            shiftId,
            movementType: "CASH_REFUND",
            amount: amountToProcess,
            reference: refund.refundNumber,
            notes: refund.reason
          }
        });
      }

      if ((refund.method === "STORE_CREDIT" || refund.method === "CREDIT_NOTE") && !refund.customer) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Customer-linked refund method requires a customer", StatusCodes.BAD_REQUEST);
      }

      if (refund.customer && refund.method === "STORE_CREDIT") {
        const before = numeric(refund.customer.storeCreditBalance);
        const after = before + amountToProcess;
        await tx.customer.update({ where: { id: refund.customer.id }, data: { storeCreditBalance: after } });
        await tx.customerLedgerEntry.create({
          data: {
            organizationId: auth.organizationId,
            branchId: refund.branchId,
            customerId: refund.customer.id,
            entryType: "STORE_CREDIT",
            balanceType: "STORE_CREDIT",
            amount: amountToProcess,
            balanceBefore: before,
            balanceAfter: after,
            referenceType: "Refund",
            referenceId: refund.id,
            notes: refund.reason,
            createdById: auth.userId
          }
        });
      }

      if (refund.customer && refund.method === "CREDIT_NOTE") {
        const invoice = refund.originalInvoice ?? await tx.invoice.findFirst({ where: { saleId: refund.originalSaleId } });
        if (!invoice) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Credit note refund requires an invoice", StatusCodes.BAD_REQUEST);
        }

        const count = await tx.creditNote.count({ where: { organizationId: auth.organizationId } });
        await tx.creditNote.create({
          data: {
            organizationId: auth.organizationId,
            customerId: refund.customer.id,
            invoiceId: invoice.id,
            creditNoteNumber: `CRN-${(count + 1).toString().padStart(6, "0")}`,
            amount: amountToProcess,
            status: "APPROVED",
            reason: refund.reason
          }
        });
      }

      if (["CASH", "BANK_TRANSFER"].includes(refund.method)) {
        const count = await tx.payment.count({ where: { organizationId: auth.organizationId } });
        await tx.payment.create({
          data: {
            organizationId: auth.organizationId,
            branchId: refund.branchId,
            paymentNumber: `PMT-${(count + 1).toString().padStart(6, "0")}`,
            customerId: refund.customerId,
            saleId: refund.originalSaleId,
            shiftId,
            direction: "OUTGOING",
            paymentMethod: refund.method as PaymentMethod,
            amount: amountToProcess,
            currencyCode: refund.originalSale.currencyCode,
            reference: input.providerReference ?? refund.refundNumber,
            status: "COMPLETED",
            receivedById: auth.userId,
            receivedAt: new Date(),
            idempotencyKey: `refund:${refund.id}`
          }
        });
      }

      const completed = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: "COMPLETED",
          processedById: auth.userId,
          processedAt: new Date(),
          completedAt: new Date(),
          providerReference: input.providerReference ?? null,
          providerStatus: refund.method === "BANK_TRANSFER" ? "CONFIRMED" : "MANUAL_CONFIRMED"
        }
      });

      const completedRefunds = await tx.refund.findMany({
        where: { originalSaleId: refund.originalSaleId, status: "COMPLETED" },
        select: {
          amount: true,
          approvedAmount: true
        }
      });
      const refundedTotal = completedRefunds.reduce((sum, entry) => sum + getActiveRefundAmount(entry), 0);
      await tx.sale.update({
        where: { id: refund.originalSaleId },
        data: {
          paymentStatus:
            refundedTotal >= numeric(refund.originalSale.amountPaid)
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: refund.branchId,
        userId: auth.userId,
        action: "refund.complete",
        entityType: "Refund",
        entityId: refund.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: refund,
        afterData: completed
      }, tx);

      return completed;
    });
  }
};
