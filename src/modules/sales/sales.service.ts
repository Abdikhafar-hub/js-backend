import { Prisma, SaleStatus, SaleType, PaymentStatus, LoyaltyLedgerEntryType, WholesaleQuotationStatus, InventoryMovementType, InvoiceStatus, InventoryReservationStatus, UserRole, PaymentMethod, InvoiceType, InvoiceSource } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { inventoryWriteService } from "../../services/inventory-write.service.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";
import { postCustomerBalanceEntry } from "../../services/customer-ledger.service.js";
import { reserveInvoiceDocumentNumber } from "./invoice-numbering.js";

const getSalesWhere = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return {
    organizationId: scope.organizationId,
    ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
  };
};

const completedSaleStatuses = [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_RETURNED, SaleStatus.FULLY_RETURNED];

const toTrimmedString = (value: unknown) => typeof value === "string" ? value.trim() : "";

const parseEnumList = <T extends string>(value: unknown, allowed: readonly T[]) => {
  const items = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry ?? "").split(","))
    .map((entry) => entry.trim())
    .filter((entry): entry is T => Boolean(entry) && allowed.includes(entry as T));

  return Array.from(new Set(items));
};

const appendWhereAnd = (where: Prisma.SaleWhereInput, condition: Prisma.SaleWhereInput | null | undefined) => {
  if (!condition) return;

  where.AND = Array.isArray(where.AND)
    ? [...where.AND, condition]
    : where.AND
      ? [where.AND, condition]
      : [condition];
};

const parseDateInput = (value: unknown) => {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const endOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
};

const startOfWeek = (date: Date) => {
  const result = startOfDay(date);
  const day = result.getDay();
  const diff = (day + 6) % 7;
  result.setDate(result.getDate() - diff);
  return result;
};

const invoiceScopedWhere = (auth: AuthContext, branchId?: string | null): Prisma.InvoiceWhereInput => {
  const scope = buildUserScope(auth);
  const where: Prisma.InvoiceWhereInput = {
    organizationId: scope.organizationId
  };

  if (auth.role === UserRole.SALES_ATTENDANT) {
    where.sale = { attendantId: auth.userId };
  } else if (scope.branchIds?.length) {
    where.OR = [
      { branchId: { in: scope.branchIds } },
      { sale: { branchId: { in: scope.branchIds } } }
    ];
  }

  if (branchId) {
    assertBranchAccess(auth, branchId);
    const branchCondition: Prisma.InvoiceWhereInput = {
      OR: [{ branchId }, { sale: { branchId } }]
    };
    where.AND = Array.isArray(where.AND)
      ? [...where.AND, branchCondition]
      : where.AND
        ? [where.AND, branchCondition]
        : [branchCondition];
  }

  return where;
};

const invoiceAmount = (value: Prisma.Decimal | number | string | null | undefined) => Number(value ?? 0);

const invoicePaymentStatus = (invoice: { amountPaid: Prisma.Decimal | number | string; totalAmount: Prisma.Decimal | number | string; amountDue: Prisma.Decimal | number | string }) => {
  const totalAmount = invoiceAmount(invoice.totalAmount);
  const amountPaid = invoiceAmount(invoice.amountPaid);
  const amountDue = invoiceAmount(invoice.amountDue);

  if (amountPaid <= 0.009) return "UNPAID";
  if (amountPaid > totalAmount + 0.009) return "OVERPAID";
  if (amountDue <= 0.009) return "PAID";
  return "PARTIAL";
};

const invoiceDisplayStatus = (invoice: {
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  dueDate: Date;
  amountDue: Prisma.Decimal | number | string;
}) => {
  const todayStart = startOfDay(new Date());
  if (invoice.status === InvoiceStatus.DRAFT) return "DRAFT";
  if (invoice.status === InvoiceStatus.VOIDED) return "VOIDED";
  if (invoice.invoiceType === InvoiceType.PRO_FORMA) return "PRO_FORMA";
  if (invoiceAmount(invoice.amountDue) > 0.009 && startOfDay(invoice.dueDate).getTime() < todayStart.getTime()) return "OVERDUE";
  if (invoice.status === InvoiceStatus.PAID) return "PAID";
  if (invoice.status === InvoiceStatus.PARTIALLY_PAID) return "PARTIALLY_PAID";
  return "ISSUED";
};

const invoiceAgingBucket = (invoice: { dueDate: Date; amountDue: Prisma.Decimal | number | string; status: InvoiceStatus; invoiceType: InvoiceType }) => {
  if (invoice.invoiceType === InvoiceType.PRO_FORMA || invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.VOIDED || invoiceAmount(invoice.amountDue) <= 0.009) {
    return "CURRENT";
  }

  const today = startOfDay(new Date());
  const due = startOfDay(invoice.dueDate);
  const daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (24 * 60 * 60 * 1000)));

  if (daysOverdue <= 0) return "CURRENT";
  if (daysOverdue <= 30) return "1_TO_30";
  if (daysOverdue <= 60) return "31_TO_60";
  if (daysOverdue <= 90) return "61_TO_90";
  return "OVER_90";
};

const serializeInvoiceRecord = <T extends {
  amountPaid: Prisma.Decimal | number | string;
  amountDue: Prisma.Decimal | number | string;
  totalAmount: Prisma.Decimal | number | string;
  dueDate: Date;
  status: InvoiceStatus;
  invoiceType: InvoiceType;
}>(invoice: T) => {
  const daysOverdue = Math.max(
    0,
    Math.floor((startOfDay(new Date()).getTime() - startOfDay(invoice.dueDate).getTime()) / (24 * 60 * 60 * 1000))
  );

  return {
    ...invoice,
    paymentStatus: invoicePaymentStatus(invoice),
    displayStatus: invoiceDisplayStatus(invoice),
    daysOverdue,
    agingBucket: invoiceAgingBucket(invoice)
  };
};

const buildInvoiceListWhere = (auth: AuthContext, query: Record<string, unknown>) => {
  const branchId = toTrimmedString(query.branchId);
  const where: Prisma.InvoiceWhereInput = invoiceScopedWhere(auth, branchId);

  const invoiceNumber = toTrimmedString(query.invoiceNumber || query.search);
  if (invoiceNumber) {
    appendInvoiceWhere(where, {
      OR: [
        { invoiceNumber: { contains: invoiceNumber, mode: "insensitive" } },
        { customerPurchaseOrderRef: { contains: invoiceNumber, mode: "insensitive" } },
        { externalReference: { contains: invoiceNumber, mode: "insensitive" } },
        { notes: { contains: invoiceNumber, mode: "insensitive" } }
      ]
    });
  }

  const customer = toTrimmedString(query.customer);
  if (customer) {
    appendInvoiceWhere(where, {
      customer: {
        OR: [
          { firstName: { contains: customer, mode: "insensitive" } },
          { lastName: { contains: customer, mode: "insensitive" } },
          { businessName: { contains: customer, mode: "insensitive" } }
        ]
      }
    });
  }

  const phone = toTrimmedString(query.phone);
  if (phone) appendInvoiceWhere(where, { customer: { phone: { contains: phone } } });

  const email = toTrimmedString(query.email);
  if (email) appendInvoiceWhere(where, { customer: { email: { contains: email, mode: "insensitive" } } });

  const customerNumber = toTrimmedString(query.customerNumber);
  if (customerNumber) appendInvoiceWhere(where, { customer: { customerNumber: { contains: customerNumber, mode: "insensitive" } } });

  const invoiceTypes = parseEnumList(query.invoiceType, Object.values(InvoiceType));
  if (invoiceTypes.length === 1) where.invoiceType = invoiceTypes[0];
  else if (invoiceTypes.length > 1) where.invoiceType = { in: invoiceTypes };

  const sources = parseEnumList(query.source, Object.values(InvoiceSource));
  if (sources.length === 1) where.source = sources[0];
  else if (sources.length > 1) where.source = { in: sources };

  const directStatuses = parseEnumList(query.status, Object.values(InvoiceStatus));
  const rawStatuses = (Array.isArray(query.status) ? query.status : [query.status])
    .flatMap((entry) => String(entry ?? "").split(","))
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  if (directStatuses.length === 1) where.status = directStatuses[0];
  else if (directStatuses.length > 1) where.status = { in: directStatuses };
  if (rawStatuses.includes("ISSUED")) {
    appendInvoiceWhere(where, {
      invoiceType: { not: InvoiceType.PRO_FORMA },
      status: InvoiceStatus.SENT
    });
  }
  if (rawStatuses.includes("PRO_FORMA")) {
    appendInvoiceWhere(where, { invoiceType: InvoiceType.PRO_FORMA });
  }
  if (rawStatuses.includes("OVERDUE")) {
    const todayStart = startOfDay(new Date());
    appendInvoiceWhere(where, {
      invoiceType: { not: InvoiceType.PRO_FORMA },
      status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.VOIDED, InvoiceStatus.PAID] },
      amountDue: { gt: 0 },
      dueDate: { lt: todayStart }
    });
  }

  const issueDateFrom = parseDateInput(query.dateFrom);
  const issueDateTo = parseDateInput(query.dateTo);
  if (issueDateFrom || issueDateTo) {
    where.issueDate = {
      ...(issueDateFrom ? { gte: issueDateFrom } : {}),
      ...(issueDateTo ? { lte: issueDateTo } : {})
    };
  }

  const dueDateFrom = parseDateInput(query.dueDateFrom);
  const dueDateTo = parseDateInput(query.dueDateTo);
  if (dueDateFrom || dueDateTo) {
    where.dueDate = {
      ...(dueDateFrom ? { gte: dueDateFrom } : {}),
      ...(dueDateTo ? { lte: dueDateTo } : {})
    };
  }

  const overdueOnly = String(query.overdueOnly ?? "") === "true";
  if (overdueOnly) {
    const todayStart = startOfDay(new Date());
    appendInvoiceWhere(where, {
      invoiceType: { not: InvoiceType.PRO_FORMA },
      status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.VOIDED, InvoiceStatus.PAID] },
      amountDue: { gt: 0 },
      dueDate: { lt: todayStart }
    });
  }

  if (String(query.creditCustomer ?? "") === "true") {
    appendInvoiceWhere(where, { customer: { creditAllowed: true } });
  }

  if (String(query.hasBalance ?? "") === "true") {
    appendInvoiceWhere(where, { amountDue: { gt: 0 } });
  }

  const amountMin = Number(query.amountMin);
  const amountMax = Number(query.amountMax);
  if (Number.isFinite(amountMin) || Number.isFinite(amountMax)) {
    where.totalAmount = {
      ...(Number.isFinite(amountMin) ? { gte: amountMin } : {}),
      ...(Number.isFinite(amountMax) ? { lte: amountMax } : {})
    };
  }

  const salesperson = toTrimmedString(query.salesperson);
  if (salesperson) {
    appendInvoiceWhere(where, {
      OR: [
        { createdBy: { firstName: { contains: salesperson, mode: "insensitive" } } },
        { createdBy: { lastName: { contains: salesperson, mode: "insensitive" } } },
        { createdBy: { email: { contains: salesperson, mode: "insensitive" } } },
        { sale: { attendant: { firstName: { contains: salesperson, mode: "insensitive" } } } },
        { sale: { attendant: { lastName: { contains: salesperson, mode: "insensitive" } } } }
      ]
    });
  }

  const paymentStatus = toTrimmedString(query.paymentStatus).toUpperCase();
  if (paymentStatus === "PAID") appendInvoiceWhere(where, { amountDue: { lte: 0 } });
  if (paymentStatus === "UNPAID") appendInvoiceWhere(where, { amountPaid: { lte: 0 }, amountDue: { gt: 0 } });
  if (paymentStatus === "PARTIAL") appendInvoiceWhere(where, { amountPaid: { gt: 0 }, amountDue: { gt: 0 } });

  return where;
};

const appendInvoiceWhere = (where: Prisma.InvoiceWhereInput, condition: Prisma.InvoiceWhereInput | null | undefined) => {
  if (!condition) return;

  where.AND = Array.isArray(where.AND)
    ? [...where.AND, condition]
    : where.AND
      ? [where.AND, condition]
      : [condition];
};

const buildSalesListWhere = (auth: AuthContext, query: Record<string, unknown>) => {
  const scope = buildUserScope(auth);
  const where: Prisma.SaleWhereInput = {
    organizationId: scope.organizationId
  };

  if (auth.role === UserRole.SALES_ATTENDANT) {
    where.attendantId = auth.userId;
  } else if (scope.branchIds) {
    where.branchId = { in: scope.branchIds };
  }

  const branchId = toTrimmedString(query.branchId);
  if (branchId) {
    assertBranchAccess(auth, branchId);
    where.branchId = branchId;
  }

  const customerId = toTrimmedString(query.customerId);
  if (customerId) where.customerId = customerId;

  const saleTypes = parseEnumList(query.saleType, Object.values(SaleType));
  if (saleTypes.length === 1) where.saleType = saleTypes[0];
  else if (saleTypes.length > 1) where.saleType = { in: saleTypes };

  const paymentStatuses = parseEnumList(query.paymentStatus, Object.values(PaymentStatus));
  if (paymentStatuses.length === 1) where.paymentStatus = paymentStatuses[0];
  else if (paymentStatuses.length > 1) where.paymentStatus = { in: paymentStatuses };

  const directStatuses = parseEnumList(query.status, Object.values(SaleStatus));
  const rawStatuses = (Array.isArray(query.status) ? query.status : [query.status])
    .flatMap((entry) => String(entry ?? "").split(","))
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  const statusOr: Prisma.SaleWhereInput[] = [];
  if (directStatuses.length === 1) statusOr.push({ status: directStatuses[0] });
  else if (directStatuses.length > 1) statusOr.push({ status: { in: directStatuses } });
  if (rawStatuses.includes("REFUNDED")) {
    statusOr.push({ paymentStatus: { in: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] } });
  }
  if (rawStatuses.includes("EXCHANGED")) {
    statusOr.push({ originalExchanges: { some: {} } });
  }
  if (statusOr.length === 1) appendWhereAnd(where, statusOr[0]);
  else if (statusOr.length > 1) appendWhereAnd(where, { OR: statusOr });

  const paymentMethods = parseEnumList(query.paymentMethod, Object.values(PaymentMethod));
  if (paymentMethods.length === 1) {
    appendWhereAnd(where, { payments: { some: { paymentMethod: paymentMethods[0] } } });
  } else if (paymentMethods.length > 1) {
    appendWhereAnd(where, { payments: { some: { paymentMethod: { in: paymentMethods } } } });
  }

  const dateFrom = parseDateInput(query.dateFrom);
  const dateTo = parseDateInput(query.dateTo);
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {})
    };
  }

  if (String(query.walkIn ?? "") === "true") where.customerId = null;
  if (String(query.creditOnly ?? "") === "true") {
    appendWhereAnd(where, {
      OR: [
        { amountDue: { gt: 0 } },
        { paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID, PaymentStatus.CREDIT] } }
      ]
    });
  }

  const invoiceNumber = toTrimmedString(query.invoiceNumber);
  if (invoiceNumber) {
    appendWhereAnd(where, { invoices: { some: { invoiceNumber: { contains: invoiceNumber, mode: "insensitive" } } } });
  }

  const receiptNumber = toTrimmedString(query.receiptNumber);
  if (receiptNumber) {
    appendWhereAnd(where, {
      payments: {
        some: {
          OR: [
            { paymentNumber: { contains: receiptNumber, mode: "insensitive" } },
            { reference: { contains: receiptNumber, mode: "insensitive" } }
          ]
        }
      }
    });
  }

  const orderNumber = toTrimmedString(query.orderNumber);
  if (orderNumber) appendWhereAnd(where, { saleNumber: { contains: orderNumber, mode: "insensitive" } });

  const customerSearch = toTrimmedString(query.customer);
  if (customerSearch) {
    appendWhereAnd(where, {
      customer: {
        OR: [
          { firstName: { contains: customerSearch, mode: "insensitive" } },
          { lastName: { contains: customerSearch, mode: "insensitive" } },
          { businessName: { contains: customerSearch, mode: "insensitive" } }
        ]
      }
    });
  }

  const customerPhone = toTrimmedString(query.phone);
  if (customerPhone) appendWhereAnd(where, { customer: { phone: { contains: customerPhone } } });

  const sku = toTrimmedString(query.sku);
  if (sku) {
    appendWhereAnd(where, {
      items: {
        some: {
          OR: [
            { skuSnapshot: { contains: sku, mode: "insensitive" } },
            { productVariant: { sku: { contains: sku, mode: "insensitive" } } }
          ]
        }
      }
    });
  }

  const barcode = toTrimmedString(query.barcode);
  if (barcode) {
    appendWhereAnd(where, {
      items: {
        some: {
          productVariant: {
            OR: [
              { barcode: { contains: barcode, mode: "insensitive" } },
              { barcodes: { some: { barcode: { contains: barcode, mode: "insensitive" } } } }
            ]
          }
        }
      }
    });
  }

  const salesperson = toTrimmedString(query.salesperson);
  if (salesperson) {
    appendWhereAnd(where, {
      OR: [
        { attendant: { firstName: { contains: salesperson, mode: "insensitive" } } },
        { attendant: { lastName: { contains: salesperson, mode: "insensitive" } } },
        { attendant: { email: { contains: salesperson, mode: "insensitive" } } }
      ]
    });
  }

  const search = toTrimmedString(query.search);
  if (search) {
    appendWhereAnd(where, {
      OR: [
        { saleNumber: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        {
          customer: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { businessName: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { email: { contains: search, mode: "insensitive" } }
            ]
          }
        },
        {
          items: {
            some: {
              OR: [
                { skuSnapshot: { contains: search, mode: "insensitive" } },
                { productNameSnapshot: { contains: search, mode: "insensitive" } },
                { variantSnapshot: { contains: search, mode: "insensitive" } },
                { productVariant: { sku: { contains: search, mode: "insensitive" } } },
                { productVariant: { barcode: { contains: search, mode: "insensitive" } } },
                { productVariant: { barcodes: { some: { barcode: { contains: search, mode: "insensitive" } } } } }
              ]
            }
          }
        },
        { invoices: { some: { invoiceNumber: { contains: search, mode: "insensitive" } } } },
        {
          payments: {
            some: {
              OR: [
                { paymentNumber: { contains: search, mode: "insensitive" } },
                { reference: { contains: search, mode: "insensitive" } }
              ]
            }
          }
        },
        {
          attendant: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } }
            ]
          }
        }
      ]
    });
  }

  return where;
};

type CheckoutLine = {
  productVariantId: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineSubtotal: number;
  lineTotal: number;
  variant: Prisma.ProductVariantGetPayload<{ include: { product: true } }>;
};

export const prepareCheckout = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  input: Record<string, any>,
  enforceSettlement = true
) => {
  assertBranchAccess(auth, input.branchId);

  const [branch, settings] = await Promise.all([
    tx.branch.findFirst({
      where: { id: input.branchId, organizationId: auth.organizationId, status: "ACTIVE" }
    }),
    tx.organizationSetting.findUnique({ where: { organizationId: auth.organizationId } })
  ]);
  if (!branch) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Active branch not found", StatusCodes.NOT_FOUND);
  }

  const activeShift = await tx.shift.findFirst({
    where: {
      organizationId: auth.organizationId,
      branchId: branch.id,
      userId: auth.userId,
      status: "OPEN"
    },
    orderBy: { openedAt: "desc" }
  });
  if (enforceSettlement && auth.role === UserRole.SALES_ATTENDANT && (settings?.saleRequiresOpenShift ?? true) && !activeShift) {
    throw new AppError(ERROR_CODES.SHIFT_NOT_OPEN, "An open shift is required before checkout", StatusCodes.CONFLICT);
  }

  const customer = input.customerId
    ? await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: auth.organizationId, status: "ACTIVE" }
      })
    : null;
  if (input.customerId && !customer) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Active customer not found", StatusCodes.NOT_FOUND);
  }

  const discountApproval = input.discountRequestId
    ? await tx.discountRequest.findFirst({
        where: {
          id: input.discountRequestId,
          organizationId: auth.organizationId,
          branchId: branch.id,
          requestedById: auth.userId,
          status: "APPROVED",
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }]
        }
      })
    : null;
  if (input.discountRequestId && !discountApproval) {
    throw new AppError(ERROR_CODES.ACCESS_DENIED, "Discount approval is invalid or expired", StatusCodes.FORBIDDEN);
  }

  const priceListId = input.priceListId ?? branch.defaultPriceListId;
  const now = new Date();
  const priceList = priceListId
    ? await tx.priceList.findFirst({
        where: {
          id: priceListId,
          organizationId: auth.organizationId,
          status: "ACTIVE",
          OR: [{ branchId: null }, { branchId: branch.id }],
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validUntil: null }, { validUntil: { gte: now } }] }
          ]
        }
      })
    : null;
  if (priceListId && !priceList) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Price list is not valid for this branch", StatusCodes.BAD_REQUEST);
  }

  const variantIds = input.items.map((item: any) => String(item.productVariantId));
  if (new Set(variantIds).size !== variantIds.length) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Duplicate variants must be combined into one checkout line", StatusCodes.BAD_REQUEST);
  }
  const variants = await tx.productVariant.findMany({
    where: {
      id: { in: variantIds },
      organizationId: auth.organizationId,
      status: "ACTIVE",
      product: { isActive: true }
    },
    include: { product: true }
  });
  if (variants.length !== variantIds.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "One or more active products were not found", StatusCodes.NOT_FOUND);
  }

  const roleDiscountLimit = auth.role === UserRole.GENERAL_MANAGER
    ? Number.POSITIVE_INFINITY
    : Number(auth.role === UserRole.BRANCH_MANAGER
      ? settings?.maximumBranchManagerDiscount ?? 0
      : settings?.maximumAttendantDiscount ?? 0);
  const taxRate = settings?.taxEnabled ? Number(settings.defaultTaxRate) : 0;
  const saleType = input.saleType as SaleType;
  const items: CheckoutLine[] = [];

  for (const requested of input.items) {
    const variant = variants.find((candidate) => candidate.id === requested.productVariantId)!;
    const quantity = Number(requested.quantity);
    const minimumWholesaleQuantity = Math.max(
      Number(settings?.wholesaleMinimumQuantity ?? 1),
      Number(variant.minimumWholesaleQuantity)
    );
    if (saleType === SaleType.WHOLESALE && quantity < minimumWholesaleQuantity) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `${variant.sku} requires a minimum wholesale quantity of ${minimumWholesaleQuantity}`,
        StatusCodes.BAD_REQUEST
      );
    }

    const priceItem = priceList
      ? await tx.priceListItem.findFirst({
          where: {
            priceListId: priceList.id,
            productVariantId: variant.id,
            minimumQuantity: { lte: quantity },
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validUntil: null }, { validUntil: { gte: now } }] }
            ]
          },
          orderBy: { minimumQuantity: "desc" }
        })
      : null;
    const unitPrice = Number(
      priceItem?.unitPrice ?? (saleType === SaleType.WHOLESALE ? variant.wholesalePrice : variant.retailPrice)
    );
    if (unitPrice <= 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, `No valid selling price is configured for ${variant.sku}`, StatusCodes.BAD_REQUEST);
    }

    const lineSubtotal = quantity * unitPrice;
    const discountAmount = Number(requested.discountAmount ?? 0);
    const requestedPercent = lineSubtotal > 0 ? (discountAmount / lineSubtotal) * 100 : 0;
    const priceLimit = priceItem?.maximumDiscountPercent == null
      ? roleDiscountLimit
      : Number(priceItem.maximumDiscountPercent);
    const allowedPercent = Math.min(roleDiscountLimit, priceLimit);
    if (discountAmount > lineSubtotal || (requestedPercent > allowedPercent + 0.0001 && !discountApproval)) {
      throw new AppError(
        ERROR_CODES.ACCESS_DENIED,
        `Discount for ${variant.sku} exceeds your ${allowedPercent}% authority and requires approval`,
        StatusCodes.FORBIDDEN
      );
    }

    const taxableAmount = lineSubtotal - discountAmount;
    const taxAmount = taxableAmount * (taxRate / 100);
    items.push({
      productVariantId: variant.id,
      quantity,
      unitPrice,
      discountAmount,
      taxRate,
      taxAmount,
      lineSubtotal,
      lineTotal: taxableAmount + taxAmount,
      variant
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.lineSubtotal, 0);
  const totalDiscount = items.reduce((sum, item) => sum + item.discountAmount, 0);
  const totalTax = items.reduce((sum, item) => sum + item.taxAmount, 0);
  const totalAmount = subtotal - totalDiscount + totalTax;
  if (discountApproval) {
    const overallPercent = subtotal > 0 ? (totalDiscount / subtotal) * 100 : 0;
    if (
      (discountApproval.requestedAmount != null && totalDiscount > Number(discountApproval.requestedAmount) + 0.01) ||
      (discountApproval.requestedPercent != null && overallPercent > Number(discountApproval.requestedPercent) + 0.0001)
    ) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Checkout discount exceeds the approved request", StatusCodes.FORBIDDEN);
    }
  }
  const totalPaid = input.payments.reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
  if (enforceSettlement && totalPaid > totalAmount + 0.01) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Payments cannot exceed the sale total", StatusCodes.BAD_REQUEST);
  }
  const balanceDue = Math.max(0, totalAmount - totalPaid);
  if (enforceSettlement && balanceDue > 0) {
    if (!customer?.creditAllowed) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Partial payment requires an approved credit customer", StatusCodes.FORBIDDEN);
    }
    const availableCredit = Number(customer.creditLimit) - Number(customer.currentOutstandingBalance);
    if (balanceDue > availableCredit + 0.01) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Customer credit limit would be exceeded", StatusCodes.FORBIDDEN);
    }
  }

  for (const payment of enforceSettlement ? input.payments : []) {
    if (payment.paymentMethod === "CASH" && !activeShift) {
      throw new AppError(ERROR_CODES.SHIFT_NOT_OPEN, "Cash payment requires an open shift", StatusCodes.CONFLICT);
    }
    if (payment.paymentMethod === "MPESA") {
      const verified = await tx.mpesaTransaction.findFirst({
        where: {
          organizationId: auth.organizationId,
          branchId: branch.id,
          status: "SUCCESS",
          mpesaReceiptNumber: payment.reference,
          amount: Number(payment.amount),
          paymentId: null,
          saleId: null
        }
      });
      if (!verified) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "M-Pesa payment has not been verified", StatusCodes.CONFLICT);
      }
    }
  }

  return { branch, settings, activeShift, customer, priceList, discountApproval, saleType, items, subtotal, totalDiscount, totalTax, totalAmount, totalPaid, balanceDue };
};

export const salesService = {
  // ==========================================
  // QUOTATIONS
  // ==========================================

  async listQuotations(auth: AuthContext, query: Record<string, any> = {}) {
    const where: any = getSalesWhere(auth);
    if (query.branchId) { assertBranchAccess(auth, String(query.branchId)); where.branchId = String(query.branchId); }
    return prisma.wholesaleQuotation.findMany({
      where,
      include: {
        customer: true,
        branch: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getQuotation(auth: AuthContext, id: string) {
    const quote = await prisma.wholesaleQuotation.findFirst({
      where: { id, ...getSalesWhere(auth) },
      include: {
        customer: true,
        branch: true,
        items: {
          include: {
            productVariant: {
              include: { product: true }
            }
          }
        }
      }
    });

    if (!quote) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Quotation not found", StatusCodes.NOT_FOUND);
    }

    return quote;
  },

  async createQuotation(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);
    return prisma.$transaction(async (tx) => {
      const count = await tx.wholesaleQuotation.count({
        where: { organizationId: auth.organizationId }
      });
      const quotationNumber = `QTN-${(count + 1).toString().padStart(6, "0")}`;

      const priced = await prepareCheckout(tx, auth, {
        branchId: input.branchId, customerId: input.customerId, saleType: SaleType.WHOLESALE,
        priceListId: input.priceListId, items: input.items, payments: [], discountRequestId: input.discountRequestId
      }, false);

      const quotation = await tx.wholesaleQuotation.create({
        data: {
          organizationId: auth.organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          quotationNumber,
          status: WholesaleQuotationStatus.DRAFT,
          subtotal: priced.subtotal,
          discountAmount: priced.totalDiscount,
          taxAmount: priced.totalTax,
          totalAmount: priced.totalAmount,
          validUntil: new Date(input.validUntil),
          notes: input.notes || null,
          createdById: auth.userId!
        }
      });

      for (const item of priced.items) {
        await tx.wholesaleQuotationItem.create({
          data: {
            quotationId: quotation.id,
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountAmount: item.discountAmount,
            lineTotal: item.lineTotal
          }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: input.branchId,
        userId: auth.userId,
        action: "quotation.create",
        entityType: "WholesaleQuotation",
        entityId: quotation.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: quotation
      }, tx);

      return quotation;
    });
  },

  // ==========================================
  // CHECKOUT (POS & WHOLESALE SALES)
  // ==========================================

  async invoiceWorkspaceSummary(auth: AuthContext, query: Record<string, unknown>) {
    const records = await prisma.invoice.findMany({
      where: buildInvoiceListWhere(auth, query),
      select: {
        id: true,
        customerId: true,
        invoiceType: true,
        status: true,
        issueDate: true,
        dueDate: true,
        totalAmount: true,
        amountPaid: true,
        amountDue: true,
        allocations: {
          include: {
            payment: {
              select: {
                receivedAt: true
              }
            }
          }
        }
      }
    });

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeReceivableInvoices = records.filter((invoice) =>
      invoice.invoiceType !== InvoiceType.PRO_FORMA &&
      invoice.status !== InvoiceStatus.DRAFT &&
      invoice.status !== InvoiceStatus.VOIDED
    );

    const fullyPaidLeadTimes = activeReceivableInvoices
      .filter((invoice) => invoiceAmount(invoice.amountDue) <= 0.009 && invoice.allocations.length > 0)
      .map((invoice) => {
        const lastPaymentDate = invoice.allocations
          .map((allocation) => allocation.payment.receivedAt)
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0];

        if (!lastPaymentDate) return null;
        return Math.max(0, Math.round((endOfDay(lastPaymentDate).getTime() - startOfDay(invoice.issueDate).getTime()) / (24 * 60 * 60 * 1000)));
      })
      .filter((value): value is number => value != null);

    const totalDaysToPay = fullyPaidLeadTimes.reduce((sum, value) => sum + value, 0);
    const displayRecords = records.map(serializeInvoiceRecord);

    return {
      totalInvoicedToday: displayRecords
        .filter((invoice) => invoice.issueDate >= todayStart && invoice.issueDate <= todayEnd && invoice.invoiceType !== InvoiceType.PRO_FORMA && invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.VOIDED)
        .reduce((sum, invoice) => sum + invoiceAmount(invoice.totalAmount), 0),
      monthToDateInvoiced: displayRecords
        .filter((invoice) => invoice.issueDate >= monthStart && invoice.invoiceType !== InvoiceType.PRO_FORMA && invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.VOIDED)
        .reduce((sum, invoice) => sum + invoiceAmount(invoice.totalAmount), 0),
      outstandingReceivables: displayRecords
        .filter((invoice) => invoice.invoiceType !== InvoiceType.PRO_FORMA && invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.VOIDED)
        .reduce((sum, invoice) => sum + invoiceAmount(invoice.amountDue), 0),
      overdueAmount: displayRecords
        .filter((invoice) => invoice.displayStatus === "OVERDUE")
        .reduce((sum, invoice) => sum + invoiceAmount(invoice.amountDue), 0),
      paidInvoices: displayRecords.filter((invoice) => invoice.paymentStatus === "PAID").length,
      partiallyPaid: displayRecords.filter((invoice) => invoice.paymentStatus === "PARTIAL").length,
      unpaid: displayRecords.filter((invoice) => invoice.paymentStatus === "UNPAID").length,
      overdueInvoices: displayRecords.filter((invoice) => invoice.displayStatus === "OVERDUE").length,
      averageDaysToPay: fullyPaidLeadTimes.length ? totalDaysToPay / fullyPaidLeadTimes.length : 0,
      creditCustomers: new Set(activeReceivableInvoices.filter((invoice) => invoiceAmount(invoice.amountDue) > 0.009 && invoice.customerId).map((invoice) => invoice.customerId)).size
    };
  },

  async listInvoices(auth: AuthContext, query: Record<string, any> = {}) {
    const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit ?? "20"), 10)));
    const skip = (page - 1) * limit;
    const where = buildInvoiceListWhere(auth, query);

    const [total, items] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: "desc" }],
        include: {
          branch: { select: { id: true, name: true, code: true } },
          customer: {
            select: {
              id: true,
              customerNumber: true,
              firstName: true,
              lastName: true,
              businessName: true,
              phone: true,
              email: true,
              customerType: true,
              creditAllowed: true
            }
          },
          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          sale: {
            select: {
              id: true,
              saleNumber: true,
              saleType: true,
              branchId: true,
              branch: { select: { id: true, name: true, code: true } },
              attendant: { select: { id: true, firstName: true, lastName: true, email: true } }
            }
          },
          items: {
            include: {
              productVariant: {
                include: { product: true }
              }
            }
          },
          allocations: {
            include: {
              payment: {
                select: {
                  id: true,
                  paymentNumber: true,
                  paymentMethod: true,
                  amount: true,
                  reference: true,
                  receivedAt: true,
                  status: true
                }
              }
            }
          }
        }
      })
    ]);

    return {
      items: items.map(serializeInvoiceRecord),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };
  },

  async createManualInvoice(auth: AuthContext, input: Record<string, any>, request: Request) {
    if (auth.role === UserRole.SALES_ATTENDANT) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Sales attendants cannot create manual invoices", StatusCodes.FORBIDDEN);
    }

    assertBranchAccess(auth, input.branchId);

    return prisma.$transaction(async (tx) => {
      const prepared = await prepareCheckout(tx, auth, {
        branchId: input.branchId,
        customerId: input.customerId ?? null,
        priceListId: input.priceListId ?? null,
        saleType: input.saleType ?? SaleType.RETAIL,
        items: input.items,
        payments: []
      }, false);

      const issueDate = parseDateInput(input.issueDate) ?? new Date();
      const dueDate = parseDateInput(input.dueDate) ?? issueDate;
      if (dueDate.getTime() < issueDate.getTime()) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Due date cannot be earlier than issue date", StatusCodes.BAD_REQUEST);
      }

      const shouldIssue = input.mode === "ISSUE";
      const invoiceType = input.invoiceType as InvoiceType;
      const paymentTermsDays = Number(input.paymentTermsDays ?? prepared.customer?.paymentTermsDays ?? 0);

      if (shouldIssue && invoiceType !== InvoiceType.PRO_FORMA && prepared.totalAmount > 0) {
        if (!prepared.customer) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "A customer is required before issuing a receivable invoice", StatusCodes.BAD_REQUEST);
        }

        const deferredCredit = endOfDay(dueDate).getTime() > endOfDay(issueDate).getTime() || paymentTermsDays > 0;
        if (deferredCredit && !prepared.customer.creditAllowed) {
          throw new AppError(ERROR_CODES.ACCESS_DENIED, "This customer is not approved for credit invoicing", StatusCodes.FORBIDDEN);
        }

        if (deferredCredit) {
          const availableCredit = Number(prepared.customer.creditLimit) - Number(prepared.customer.currentOutstandingBalance);
          if (prepared.totalAmount > availableCredit + 0.01) {
            throw new AppError(ERROR_CODES.ACCESS_DENIED, "Customer credit limit would be exceeded", StatusCodes.FORBIDDEN);
          }
        }
      }

      const branch = prepared.branch;
      const invoiceNumber = shouldIssue
        ? await reserveInvoiceDocumentNumber(tx, {
            organizationId: auth.organizationId,
            branchId: branch.id,
            branchCode: branch.code,
            issuedAt: issueDate,
            kind: invoiceType === InvoiceType.PRO_FORMA ? "PRO_FORMA" : "INVOICE"
          })
        : `DRAFT-${branch.code}-${Date.now()}`;

      const backingSale = await tx.sale.create({
        data: {
          organizationId: auth.organizationId,
          branchId: branch.id,
          customerId: prepared.customer?.id ?? null,
          saleNumber: `INVSRC-${Date.now()}`,
          saleType: input.saleType ?? SaleType.RETAIL,
          attendantId: auth.userId!,
          shiftId: prepared.activeShift?.id ?? null,
          priceListId: prepared.priceList?.id ?? null,
          currencyCode: input.currencyCode || prepared.settings?.defaultCurrency || "KES",
          status: SaleStatus.SUSPENDED,
          paymentStatus: PaymentStatus.UNPAID,
          fulfillmentStatus: "PENDING",
          subtotal: prepared.subtotal,
          lineDiscountAmount: prepared.totalDiscount,
          orderDiscountAmount: 0,
          taxAmount: prepared.totalTax,
          totalAmount: prepared.totalAmount,
          amountPaid: 0,
          amountDue: prepared.totalAmount,
          notes: input.notes || null,
          suspendedAt: new Date()
        }
      });

      for (const item of prepared.items) {
        await tx.saleItem.create({
          data: {
            saleId: backingSale.id,
            productVariantId: item.productVariantId,
            skuSnapshot: item.variant.sku,
            productNameSnapshot: item.variant.product.name,
            variantSnapshot: `${item.variant.volumeValue ?? ""} ${item.variant.volumeUnit ?? ""}`.trim(),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            originalUnitPrice: item.variant.retailPrice,
            discountAmount: item.discountAmount,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            unitCost: 0,
            lineCost: 0,
            lineSubtotal: item.lineSubtotal,
            lineTotal: item.lineTotal,
            notes: null
          }
        });
      }

      const invoice = await tx.invoice.create({
        data: {
          organizationId: auth.organizationId,
          branchId: branch.id,
          invoiceNumber,
          saleId: backingSale.id,
          customerId: prepared.customer?.id ?? null,
          createdById: auth.userId,
          invoiceType,
          source: (input.source as InvoiceSource) ?? InvoiceSource.MANUAL,
          status: shouldIssue ? InvoiceStatus.SENT : InvoiceStatus.DRAFT,
          currencyCode: input.currencyCode || prepared.settings?.defaultCurrency || "KES",
          paymentTermsDays,
          issueDate,
          dueDate,
          issuedAt: shouldIssue ? issueDate : null,
          subtotal: prepared.subtotal,
          discountAmount: prepared.totalDiscount,
          taxAmount: prepared.totalTax,
          totalAmount: prepared.totalAmount,
          amountPaid: 0,
          amountDue: prepared.totalAmount,
          customerPurchaseOrderRef: input.customerPurchaseOrderRef || null,
          externalReference: input.externalReference || null,
          billingAddress: input.billingAddress || null,
          shippingAddress: input.shippingAddress || null,
          deliveryMethod: input.deliveryMethod || null,
          contactPerson: input.contactPerson || null,
          expectedDeliveryDate: parseDateInput(input.expectedDeliveryDate),
          deliveryInstructions: input.deliveryInstructions || null,
          notes: input.notes || null
        }
      });

      for (const item of prepared.items) {
        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal
          }
        });
      }

      if (shouldIssue && invoiceType !== InvoiceType.PRO_FORMA && prepared.customer?.id && prepared.totalAmount > 0) {
        await postCustomerBalanceEntry(tx, {
          organizationId: auth.organizationId,
          branchId: branch.id,
          customerId: prepared.customer.id,
          amount: prepared.totalAmount,
          entryType: "INVOICE",
          referenceType: "Invoice",
          referenceId: invoice.id,
          notes: `Invoice ${invoiceNumber}`,
          createdById: auth.userId
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: branch.id,
        userId: auth.userId,
        action: shouldIssue ? "invoice.issue_manual" : "invoice.create_draft",
        entityType: "Invoice",
        entityId: invoice.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        metadata: {
          invoiceType,
          source: input.source ?? InvoiceSource.MANUAL,
          backingSaleId: backingSale.id
        },
        afterData: invoice
      }, tx);

      const created = await tx.invoice.findFirstOrThrow({
        where: { id: invoice.id },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          customer: true,
          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          sale: {
            include: {
              branch: { select: { id: true, name: true, code: true } },
              attendant: { select: { id: true, firstName: true, lastName: true, email: true } },
              items: true,
              payments: true
            }
          },
          items: {
            include: {
              productVariant: { include: { product: true } }
            }
          },
          allocations: { include: { payment: true } }
        }
      });

      return serializeInvoiceRecord(created);
    });
  },

  async getInvoice(auth: AuthContext, id: string) {
    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        ...invoiceScopedWhere(auth)
      },
      include: {
        customer: true,
        branch: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        items: {
          include: {
            productVariant: {
              include: { product: true }
            }
          }
        },
        allocations: {
          include: {
            payment: true
          }
        },
        creditNotes: {
          orderBy: { createdAt: "desc" }
        },
        debitNotes: {
          orderBy: { createdAt: "desc" }
        },
        sale: {
          include: {
            branch: true,
            attendant: { select: { id: true, firstName: true, lastName: true, email: true } },
            items: true,
            payments: true
          }
        }
      }
    });

    if (!invoice) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Invoice not found", StatusCodes.NOT_FOUND);
    }

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        organizationId: invoice.organizationId,
        OR: [
          { entityType: "Invoice", entityId: invoice.id },
          ...invoice.creditNotes.map((creditNote) => ({ entityType: "CreditNote", entityId: creditNote.id })),
          ...invoice.debitNotes.map((debitNote) => ({ entityType: "DebitNote", entityId: debitNote.id }))
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return {
      ...serializeInvoiceRecord(invoice),
      auditLogs
    };
  },

  async checkout(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);
    return prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: { organizationId: auth.organizationId, idempotencyKey: input.idempotencyKey },
        include: { items: true, payments: true, customer: true, branch: true }
      });
      if (existing) return existing;

      const prepared = await prepareCheckout(tx, auth, input);
      const {
        settings, activeShift, customer, priceList, discountApproval, saleType, items,
        subtotal, totalDiscount, totalTax, totalAmount, totalPaid, balanceDue
      } = prepared;
      const count = await tx.sale.count({
        where: { organizationId: auth.organizationId }
      });
      const saleNumber = `SAL-${(count + 1).toString().padStart(6, "0")}`;

      let paymentStatus: PaymentStatus = PaymentStatus.PAID;
      if (balanceDue > 0) {
        paymentStatus = totalPaid > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.UNPAID;
      }

      // Create Sale record
      const sale = await tx.sale.create({
        data: {
          organizationId: auth.organizationId,
          branchId: input.branchId,
          customerId: customer?.id ?? null,
          saleNumber,
          saleType,
          attendantId: auth.userId!,
          shiftId: activeShift?.id ?? null,
          currencyCode: settings?.defaultCurrency ?? "KES",
          priceListId: priceList?.id ?? null,
          idempotencyKey: input.idempotencyKey,
          status: SaleStatus.COMPLETED,
          paymentStatus,
          fulfillmentStatus: "COMPLETED",
          subtotal,
          lineDiscountAmount: totalDiscount,
          orderDiscountAmount: 0,
          taxAmount: totalTax,
          totalAmount,
          amountPaid: totalPaid,
          amountDue: balanceDue,
          notes: input.notes || null,
          completedAt: new Date()
        }
      });

      let totalCOGS = 0;

      // Process items and inventory deduction (FIFO)
      for (const item of items) {
        const variant = item.variant;

        const skuSnapshot = variant.sku;
        const productNameSnapshot = variant.product.name;
        const variantSnapshot = `${variant.volumeValue ?? ""} ${variant.volumeUnit ?? ""}`;

        // Deduct from inventory (this locks the balance and handles FIFO batch subtraction)
        const deduction = await inventoryWriteService.deductStock(tx, {
          organizationId: auth.organizationId,
          branchId: input.branchId,
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          referenceType: "SaleItem",
          referenceId: sale.id,
          movementType: "SALE",
          performedById: auth.userId
        });

        // Calculate COGS using allocated batch layers
        let itemCOGS = 0;
        for (const alloc of deduction.allocations) {
          itemCOGS += alloc.quantityAllocated * alloc.landedUnitCost;
        }
        totalCOGS += itemCOGS;

        const grossProfit = item.lineTotal - itemCOGS;

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productVariantId: item.productVariantId,
            skuSnapshot,
            productNameSnapshot,
            variantSnapshot,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            originalUnitPrice: variant.retailPrice,
            discountAmount: item.discountAmount,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            unitCost: item.quantity > 0 ? (itemCOGS / item.quantity) : 0,
            lineCost: itemCOGS,
            lineSubtotal: item.lineSubtotal,
            lineTotal: item.lineTotal,
            grossProfit,
            notes: null
          }
        });

        // Link batch allocations to sale item
        for (const alloc of deduction.allocations) {
          await tx.saleItemBatch.create({
            data: {
              saleItemId: saleItem.id,
              inventoryBatchId: alloc.batchId,
              quantity: alloc.quantityAllocated,
              unitCost: alloc.unitCost,
              lineCost: alloc.quantityAllocated * alloc.landedUnitCost
            }
          });
        }
      }

      // Update total COGS and gross profit on Sale
      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          costOfGoodsSold: totalCOGS,
          grossProfit: totalAmount - totalCOGS
        }
      });
      if (discountApproval) {
        await tx.discountRequest.update({
          where: { id: discountApproval.id },
          data: { status: "APPLIED", saleId: sale.id }
        });
      }

      // Record payments in Payment table
      for (const [paymentIndex, pay] of input.payments.entries()) {
        const payCount = await tx.payment.count({
          where: { organizationId: auth.organizationId }
        });
        const paymentNumber = `PMT-${(payCount + 1).toString().padStart(6, "0")}`;

        const payment = await tx.payment.create({
          data: {
            organizationId: auth.organizationId,
            branchId: input.branchId,
            paymentNumber,
            customerId: customer?.id ?? null,
            saleId: sale.id,
            shiftId: activeShift?.id ?? null,
            direction: "INCOMING",
            paymentMethod: pay.paymentMethod,
            amount: pay.amount,
            currencyCode: settings?.defaultCurrency ?? "KES",
            reference: pay.reference || null,
            status: "COMPLETED",
            receivedById: auth.userId,
            receivedAt: new Date(),
            idempotencyKey: `${input.idempotencyKey}:payment:${paymentIndex}`
          }
        });
        if (pay.paymentMethod === "CASH" && activeShift) {
          await tx.shiftCashMovement.create({
            data: {
              shiftId: activeShift.id,
              movementType: "CASH_SALE",
              amount: pay.amount,
              reference: payment.paymentNumber,
              notes: `Cash sale ${sale.saleNumber}`
            }
          });
        }

        if (pay.paymentMethod === "MPESA") {
          await tx.mpesaTransaction.update({
            where: { mpesaReceiptNumber: pay.reference },
            data: { saleId: sale.id, paymentId: payment.id, customerId: customer?.id ?? null }
          });
        }
      }

      // Customer Outstanding and Loyalty adjustments
      if (customer) {
          // Unpaid amount updates customer outstanding balance directly
          if (balanceDue > 0) {
            await postCustomerBalanceEntry(tx, {
              organizationId: auth.organizationId,
              branchId: input.branchId,
              customerId: customer.id,
              amount: balanceDue,
              entryType: "SALE_CREDIT",
              referenceType: "Sale",
              referenceId: sale.id,
              notes: `Credit balance from ${sale.saleNumber}`,
              createdById: auth.userId
            });
          }

          // Earn Loyalty Points (1 point per 100 KES paid)
          const pointsEarned = settings?.loyaltyEnabled ? Math.floor(totalPaid / 100) : 0;
          if (pointsEarned > 0) {
            const pointsBefore = Number(customer.loyaltyPointsBalance);
            const pointsAfter = pointsBefore + pointsEarned;

            await tx.loyaltyLedgerEntry.create({
              data: {
                customerId: customer.id,
                entryType: LoyaltyLedgerEntryType.EARNED,
                points: pointsEarned,
                referenceType: "Sale",
                referenceId: sale.id,
                notes: `Loyalty points earned from sale ${sale.saleNumber}`
              }
            });

            await tx.customer.update({
              where: { id: customer.id },
              data: {
                loyaltyPointsBalance: pointsAfter
              }
            });
          }
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: input.branchId,
        userId: auth.userId,
        action: "sale.checkout",
        entityType: "Sale",
        entityId: sale.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: updatedSale
      }, tx);

      return tx.sale.findUniqueOrThrow({
        where: { id: updatedSale.id },
        include: { items: true, payments: true, customer: true, branch: true }
      });
    });
  },

  async quotePrice(auth: AuthContext, input: any) {
    assertBranchAccess(auth, input.branchId);
    return prisma.$transaction(async (tx) => {
      const priced = await prepareCheckout(tx, auth, { ...input, payments: [] }, false);
      return {
        items: priced.items.map(({ variant, ...line }) => ({
          ...line,
          sku: variant.sku,
          productName: variant.product.name,
          variantName: `${variant.volumeValue ?? ""} ${variant.volumeUnit ?? ""}`
        })),
        subtotal: priced.subtotal,
        discountAmount: priced.totalDiscount,
        taxAmount: priced.totalTax,
        totalAmount: priced.totalAmount,
        currencyCode: priced.settings?.defaultCurrency ?? "KES",
        priceListId: priced.priceList?.id ?? null
      };
    });
  },

  async workspaceSummary(auth: AuthContext, query: Record<string, unknown>) {
    const scope = buildUserScope(auth);
    const branchId = toTrimmedString(query.branchId);
    if (branchId) assertBranchAccess(auth, branchId);

    const branchFilter = scope.branchIds
      ? branchId
        ? { branchId }
        : { branchId: { in: scope.branchIds } }
      : branchId
        ? { branchId }
        : {};

    const baseWhere: Prisma.SaleWhereInput = {
      organizationId: scope.organizationId,
      ...(auth.role === UserRole.SALES_ATTENDANT ? { attendantId: auth.userId } : {}),
      ...branchFilter
    };

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const yesterdayDate = new Date(todayStart);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStart = startOfDay(yesterdayDate);
    const yesterdayEnd = endOfDay(yesterdayDate);
    const weekStart = startOfWeek(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const analysisDateFrom = parseDateInput(query.dateFrom) ?? monthStart;
    const analysisDateTo = parseDateInput(query.dateTo) ?? todayEnd;
    const completedWhere: Prisma.SaleWhereInput = {
      ...baseWhere,
      status: { in: completedSaleStatuses }
    };
    const analysisWhere: Prisma.SaleWhereInput = {
      ...completedWhere,
      createdAt: { gte: analysisDateFrom, lte: analysisDateTo }
    };
    const relationalBranchFilter = branchId
      ? { branchId }
      : scope.branchIds
        ? { branchId: { in: scope.branchIds } }
        : {};

    const [today, yesterday, week, month, analysis, unitsSold, pendingPayments, creditSales, returns, refunds, exchanges] = await Promise.all([
      prisma.sale.aggregate({
        where: { ...completedWhere, createdAt: { gte: todayStart, lte: todayEnd } },
        _sum: { totalAmount: true }
      }),
      prisma.sale.aggregate({
        where: { ...completedWhere, createdAt: { gte: yesterdayStart, lte: yesterdayEnd } },
        _sum: { totalAmount: true }
      }),
      prisma.sale.aggregate({
        where: { ...completedWhere, createdAt: { gte: weekStart, lte: todayEnd } },
        _sum: { totalAmount: true }
      }),
      prisma.sale.aggregate({
        where: { ...completedWhere, createdAt: { gte: monthStart, lte: todayEnd } },
        _sum: { totalAmount: true }
      }),
      prisma.sale.aggregate({
        where: analysisWhere,
        _sum: {
          totalAmount: true,
          grossProfit: true,
          amountDue: true,
          taxAmount: true,
          lineDiscountAmount: true
        },
        _avg: { totalAmount: true },
        _count: { id: true }
      }),
      prisma.saleItem.aggregate({
        where: {
          sale: analysisWhere
        },
        _sum: { quantity: true }
      }),
      prisma.sale.aggregate({
        where: {
          ...baseWhere,
          createdAt: { gte: analysisDateFrom, lte: analysisDateTo },
          amountDue: { gt: 0 }
        },
        _sum: { amountDue: true },
        _count: { id: true }
      }),
      prisma.sale.aggregate({
        where: {
          ...baseWhere,
          createdAt: { gte: analysisDateFrom, lte: analysisDateTo },
          OR: [
            { paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID, PaymentStatus.CREDIT] } },
            { amountDue: { gt: 0 } }
          ]
        },
        _sum: { amountDue: true, totalAmount: true },
        _count: { id: true }
      }),
      prisma.returnRequest.findMany({
        where: {
          organizationId: scope.organizationId,
          ...relationalBranchFilter,
          requestedAt: { gte: analysisDateFrom, lte: analysisDateTo }
        },
        select: {
          id: true,
          items: { select: { eligibleValue: true } }
        }
      }),
      prisma.refund.aggregate({
        where: {
          organizationId: scope.organizationId,
          ...relationalBranchFilter,
          requestedAt: { gte: analysisDateFrom, lte: analysisDateTo }
        },
        _sum: { amount: true },
        _count: { id: true }
      }),
      prisma.exchange.aggregate({
        where: {
          organizationId: scope.organizationId,
          ...relationalBranchFilter,
          createdAt: { gte: analysisDateFrom, lte: analysisDateTo }
        },
        _sum: { differenceAmount: true, replacementValue: true },
        _count: { id: true }
      })
    ]);

    const returnAmount = returns.reduce(
      (sum, item) => sum + item.items.reduce((lineSum, line) => lineSum + Number(line.eligibleValue), 0),
      0
    );
    const totalRevenue = Number(analysis._sum.totalAmount ?? 0);
    const totalTax = Number(analysis._sum.taxAmount ?? 0);
    const totalDiscount = Number(analysis._sum.lineDiscountAmount ?? 0);

    return {
      todaySales: Number(today._sum.totalAmount ?? 0),
      yesterdaySales: Number(yesterday._sum.totalAmount ?? 0),
      thisWeekSales: Number(week._sum.totalAmount ?? 0),
      monthToDateSales: Number(month._sum.totalAmount ?? 0),
      transactions: analysis._count.id,
      averageBasketSize: Number(analysis._avg.totalAmount ?? 0),
      unitsSold: Number(unitsSold._sum.quantity ?? 0),
      grossProfit: Number(analysis._sum.grossProfit ?? 0),
      netRevenue: totalRevenue - totalTax,
      pendingPayments: {
        count: pendingPayments._count.id,
        amount: Number(pendingPayments._sum.amountDue ?? 0)
      },
      creditSales: {
        count: creditSales._count.id,
        amount: Number(creditSales._sum.totalAmount ?? 0),
        outstandingAmount: Number(creditSales._sum.amountDue ?? 0)
      },
      outstandingAmount: Number(analysis._sum.amountDue ?? 0),
      returns: {
        count: returns.length,
        amount: returnAmount
      },
      refunds: {
        count: refunds._count.id,
        amount: Number(refunds._sum.amount ?? 0)
      },
      exchanges: {
        count: exchanges._count.id,
        differenceAmount: Number(exchanges._sum.differenceAmount ?? 0),
        replacementValue: Number(exchanges._sum.replacementValue ?? 0)
      },
      discounts: totalDiscount,
      tax: totalTax
    };
  },

  async listSales(auth: AuthContext, query: any) {
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "20", 10)));
    const skip = (page - 1) * limit;
    const where = buildSalesListWhere(auth, query);

    const [total, items] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, email: true } },
          branch: { select: { id: true, name: true } },
          attendant: { select: { id: true, firstName: true, lastName: true, email: true } },
          items: {
            select: {
              id: true,
              productVariantId: true,
              quantity: true,
              skuSnapshot: true,
              productNameSnapshot: true
            }
          },
          payments: {
            select: {
              id: true,
              paymentNumber: true,
              paymentMethod: true,
              amount: true,
              status: true,
              reference: true
            }
          },
          invoices: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              amountDue: true,
              totalAmount: true
            }
          }
        }
      })
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };
  },

  async getSale(auth: AuthContext, id: string) {
    const scope = buildUserScope(auth);
    const where: Prisma.SaleWhereInput = {
      id,
      organizationId: scope.organizationId,
    };

    if (auth.role === "SALES_ATTENDANT") {
      where.attendantId = auth.userId;
    } else if (scope.branchIds) {
      where.branchId = { in: scope.branchIds };
    }

    const sale = await prisma.sale.findFirst({
      where,
      include: {
        items: {
          include: {
            productVariant: {
              include: { product: true }
            },
            batchAllocations: {
              include: {
                inventoryBatch: {
                  select: { id: true, batchNumber: true }
                }
              }
            }
          }
        },
        payments: true,
        customer: true,
        branch: { select: { id: true, name: true } },
        attendant: { select: { id: true, firstName: true, lastName: true, email: true } },
        invoices: {
          include: {
            items: true,
            allocations: {
              include: {
                payment: true
              }
            }
          },
          orderBy: { createdAt: "desc" }
        },
        returnRequests: {
          include: {
            items: {
              include: {
                productVariant: {
                  include: { product: true }
                },
                saleItem: true
              }
            },
            refunds: true,
            exchanges: true
          },
          orderBy: { createdAt: "desc" }
        },
        refunds: true,
        originalExchanges: {
          include: {
            returnRequest: true,
            replacementSale: {
              include: { items: true, payments: true }
            }
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!sale) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Sale not found", StatusCodes.NOT_FOUND);
    }

    const auditTargets: Array<{ entityType: string; entityId: string }> = [
      { entityType: "Sale", entityId: sale.id },
      ...sale.invoices.map((invoice) => ({ entityType: "Invoice", entityId: invoice.id })),
      ...sale.returnRequests.map((returnRequest) => ({ entityType: "ReturnRequest", entityId: returnRequest.id })),
      ...sale.refunds.map((refund) => ({ entityType: "Refund", entityId: refund.id })),
      ...sale.originalExchanges.map((exchange) => ({ entityType: "Exchange", entityId: exchange.id }))
    ];

    const [inventoryMovements, auditLogs] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where: {
          organizationId: scope.organizationId,
          branchId: sale.branchId,
          referenceType: "SaleItem",
          referenceId: sale.id
        },
        include: {
          inventoryBatch: { select: { id: true, batchNumber: true } },
          productVariant: { include: { product: true } }
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.auditLog.findMany({
        where: {
          organizationId: scope.organizationId,
          OR: auditTargets
        },
        orderBy: { createdAt: "desc" },
        take: 100
      })
    ]);

    return {
      ...sale,
      inventoryMovements,
      auditLogs
    };
  },

  async suspendSale(auth: AuthContext, input: any, request: Request) {
    assertBranchAccess(auth, input.branchId);
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const saleType = (input.saleType as SaleType | undefined) ?? SaleType.RETAIL;
      const prepared = await prepareCheckout(
        tx,
        auth,
        { ...input, saleType, payments: [] },
        false
      );
      if (auth.role === UserRole.SALES_ATTENDANT && (prepared.settings?.saleRequiresOpenShift ?? true) && !prepared.activeShift) {
        throw new AppError(ERROR_CODES.SHIFT_NOT_OPEN, "An open shift is required before suspending a sale", StatusCodes.CONFLICT);
      }
      const count = await tx.sale.count({
        where: { organizationId: scope.organizationId }
      });
      const saleNumber = `SUS-${(count + 1).toString().padStart(6, "0")}`;

      const {
        subtotal, totalDiscount, totalTax, totalAmount, items, customer,
        activeShift, settings, priceList
      } = prepared;

      const sale = await tx.sale.create({
        data: {
          organizationId: scope.organizationId,
          branchId: input.branchId,
          customerId: customer?.id ?? null,
          saleNumber,
          saleType,
          attendantId: auth.userId!,
          shiftId: activeShift?.id ?? null,
          priceListId: priceList?.id ?? null,
          currencyCode: settings?.defaultCurrency ?? "KES",
          status: SaleStatus.SUSPENDED,
          paymentStatus: PaymentStatus.UNPAID,
          fulfillmentStatus: "PENDING",
          subtotal,
          lineDiscountAmount: totalDiscount,
          orderDiscountAmount: 0,
          taxAmount: totalTax,
          totalAmount,
          amountPaid: 0,
          amountDue: totalAmount,
          notes: input.notes || null,
          suspendedAt: new Date()
        }
      });

      for (const item of items) {
        const variant = item.variant;

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productVariantId: item.productVariantId,
            skuSnapshot: variant.sku,
            productNameSnapshot: variant.product.name,
            variantSnapshot: `${variant.volumeValue ?? ""} ${variant.volumeUnit ?? ""}`,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            originalUnitPrice: variant.retailPrice,
            discountAmount: item.discountAmount,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            unitCost: 0,
            lineCost: 0,
            lineSubtotal: item.lineSubtotal,
            lineTotal: item.lineTotal,
            notes: null
          }
        });
      }

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: input.branchId,
        userId: auth.userId,
        action: "sale.suspend",
        entityType: "Sale",
        entityId: sale.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: sale
      }, tx);

      return sale;
    });
  },

  async listSuspendedSales(auth: AuthContext, query: Record<string, any> = {}) {
    const scope = buildUserScope(auth);
    const where: Prisma.SaleWhereInput = {
      organizationId: scope.organizationId,
      status: SaleStatus.SUSPENDED
    };

    if (auth.role === "SALES_ATTENDANT") {
      where.attendantId = auth.userId;
    } else if (scope.branchIds) {
      where.branchId = { in: scope.branchIds };
    }
    if (query.branchId) { assertBranchAccess(auth, String(query.branchId)); where.branchId = String(query.branchId); }

    return prisma.sale.findMany({
      where,
      orderBy: { suspendedAt: "desc" },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
        items: true
      }
    });
  },

  async deleteSuspendedSale(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const sale = await tx.sale.findFirst({
        where: {
          id,
          organizationId: scope.organizationId,
          status: SaleStatus.SUSPENDED,
          ...(auth.role === "SALES_ATTENDANT" ? { attendantId: auth.userId } : {}),
          ...(scope.branchIds && auth.role !== "SALES_ATTENDANT" ? { branchId: { in: scope.branchIds } } : {})
        }
      });
      if (!sale) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Suspended sale not found", StatusCodes.NOT_FOUND);
      }

      const updated = await tx.sale.update({
        where: { id },
        data: {
          status: SaleStatus.CANCELLED,
          notes: sale.notes ? `${sale.notes} (Discarded suspended sale)` : "Discarded suspended sale"
        }
      });

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: sale.branchId,
        userId: auth.userId,
        action: "sale.discard_suspended",
        entityType: "Sale",
        entityId: sale.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: sale,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async cancelSale(auth: AuthContext, id: string, reason: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const sale = await tx.sale.findFirst({
        where: {
          id,
          ...getSalesWhere(auth)
        },
        include: {
          items: {
            include: {
              batchAllocations: true
            }
          }
        }
      });

      if (!sale) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Sale not found", StatusCodes.NOT_FOUND);
      }

      if (sale.status === SaleStatus.VOIDED || sale.status === SaleStatus.CANCELLED) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Sale is already voided or cancelled", StatusCodes.BAD_REQUEST);
      }

      if (sale.saleType === SaleType.WHOLESALE) {
        for (const item of sale.items) {
          const reservations = await tx.inventoryReservation.findMany({
            where: { sourceType: "SaleItem", sourceId: item.id, status: InventoryReservationStatus.ACTIVE }
          });
          for (const reservation of reservations) await inventoryWriteService.releaseReservation(tx, reservation.id);
          const fulfilled = await tx.inventoryMovement.aggregate({
            where: { referenceType: "SaleItem", referenceId: item.id, movementType: InventoryMovementType.SALE },
            _sum: { quantity: true }
          });
          const fulfilledQuantity = Math.abs(Number(fulfilled._sum.quantity ?? 0));
          if (fulfilledQuantity > 0) {
            await inventoryWriteService.receiveStock(tx, {
              organizationId: sale.organizationId, branchId: sale.branchId,
              productVariantId: item.productVariantId, quantity: fulfilledQuantity,
              unitCost: Number(item.unitCost), landedUnitCost: Number(item.unitCost),
              movementType: InventoryMovementType.CUSTOMER_RETURN,
              referenceType: "SaleCancellation", referenceId: sale.id,
              performedById: auth.userId, notes: `Cancelled wholesale order ${sale.saleNumber}: ${reason}`
            });
          }
        }
      // Restore inventory if it was completed
      } else if (sale.status === SaleStatus.COMPLETED) {
        for (const item of sale.items) {
          // Restore to inventory using receiveStock
          await inventoryWriteService.receiveStock(tx, {
            organizationId: sale.organizationId,
            branchId: sale.branchId,
            productVariantId: item.productVariantId,
            quantity: Number(item.quantity),
            unitCost: Number(item.unitCost),
            landedUnitCost: Number(item.unitCost),
            movementType: InventoryMovementType.CUSTOMER_RETURN,
            referenceType: "SaleItem",
            referenceId: item.id,
            performedById: auth.userId,
            notes: `Voided sale ${sale.saleNumber}: ${reason}`
          });
        }
      }

      // Reverse customer outstanding balance if customer type
      if (sale.customerId && Number(sale.amountDue) > 0) {
        await postCustomerBalanceEntry(tx, {
          organizationId: auth.organizationId, branchId: sale.branchId, customerId: sale.customerId,
          amount: -Number(sale.amountDue), entryType: "SALE_VOID", referenceType: "Sale", referenceId: sale.id,
          notes: reason, createdById: auth.userId
        });
      }

      // Reverse loyalty points if any
      const pointsEarned = Math.floor(Number(sale.amountPaid) / 100);
      if (sale.customerId && pointsEarned > 0) {
        const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
        if (customer) {
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              loyaltyPointsBalance: { decrement: pointsEarned }
            }
          });
          await tx.loyaltyLedgerEntry.create({
            data: {
              customerId: customer.id,
              entryType: LoyaltyLedgerEntryType.REDEEMED,
              points: -pointsEarned,
              referenceType: "Sale",
              referenceId: sale.id,
              notes: `Points reversed due to voided sale ${sale.saleNumber}`
            }
          });
        }
      }

      const updated = await tx.sale.update({
        where: { id },
        data: {
          status: SaleStatus.VOIDED,
          cancellationReason: reason,
          cancelledAt: new Date()
        }
      });

      // Void linked invoices if any
      await tx.invoice.updateMany({
        where: { saleId: sale.id },
        data: { status: InvoiceStatus.VOIDED }
      });

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: sale.branchId,
        userId: auth.userId,
        action: "sale.void",
        entityType: "Sale",
        entityId: sale.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: sale,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async acceptQuotation(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const quote = await tx.wholesaleQuotation.findFirst({
        where: { id, ...getSalesWhere(auth), status: { in: [WholesaleQuotationStatus.DRAFT, WholesaleQuotationStatus.SENT] } }
      });

      if (!quote) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Quotation not found", StatusCodes.NOT_FOUND);
      }

      const updated = await tx.wholesaleQuotation.update({
        where: { id },
        data: { status: WholesaleQuotationStatus.ACCEPTED }
      });

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: quote.branchId,
        userId: auth.userId,
        action: "quotation.accept",
        entityType: "WholesaleQuotation",
        entityId: quote.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: quote,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async rejectQuotation(auth: AuthContext, id: string, notes: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const quote = await tx.wholesaleQuotation.findFirst({
        where: { id, ...getSalesWhere(auth), status: { in: [WholesaleQuotationStatus.DRAFT, WholesaleQuotationStatus.SENT] } }
      });

      if (!quote) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Quotation not found", StatusCodes.NOT_FOUND);
      }

      const updated = await tx.wholesaleQuotation.update({
        where: { id },
        data: {
          status: WholesaleQuotationStatus.REJECTED,
          notes: quote.notes ? `${quote.notes}\nRejected: ${notes}` : `Rejected: ${notes}`
        }
      });

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: quote.branchId,
        userId: auth.userId,
        action: "quotation.reject",
        entityType: "WholesaleQuotation",
        entityId: quote.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: quote,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async convertQuotation(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const quote = await tx.wholesaleQuotation.findFirst({
        where: { id, ...getSalesWhere(auth) },
        include: { items: true }
      });

      if (!quote) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Quotation not found", StatusCodes.NOT_FOUND);
      }

      if (quote.status !== WholesaleQuotationStatus.ACCEPTED) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Quotation must be accepted before converting to order", StatusCodes.BAD_REQUEST);
      }

      const count = await tx.sale.count({
        where: { organizationId: scope.organizationId }
      });
      const orderNumber = `WSO-${(count + 1).toString().padStart(6, "0")}`;

      // Create Wholesale Sales Order as a Sale (type WHOLESALE, status DRAFT)
      const order = await tx.sale.create({
        data: {
          organizationId: scope.organizationId,
          branchId: quote.branchId,
          customerId: quote.customerId,
          saleNumber: orderNumber,
          saleType: SaleType.WHOLESALE,
          attendantId: auth.userId!,
          currencyCode: "KES",
          status: SaleStatus.DRAFT, // Draft wholesale sale serves as pending order
          paymentStatus: PaymentStatus.UNPAID,
          fulfillmentStatus: "PENDING",
          subtotal: quote.subtotal,
          lineDiscountAmount: quote.discountAmount,
          orderDiscountAmount: 0,
          taxAmount: quote.taxAmount,
          totalAmount: quote.totalAmount,
          amountPaid: 0,
          amountDue: quote.totalAmount,
          notes: quote.notes ? `Converted from QTN ${quote.quotationNumber}. ${quote.notes}` : `Converted from QTN ${quote.quotationNumber}`
        }
      });

      for (const item of quote.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: item.productVariantId, organizationId: scope.organizationId },
          include: { product: true }
        });
        if (!variant) {
          throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, `Product variant ${item.productVariantId} not found`, StatusCodes.NOT_FOUND);
        }

        await tx.saleItem.create({
          data: {
            saleId: order.id,
            productVariantId: item.productVariantId,
            skuSnapshot: variant.sku,
            productNameSnapshot: variant.product.name,
            variantSnapshot: `${variant.volumeValue ?? ""} ${variant.volumeUnit ?? ""}`,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            originalUnitPrice: variant.retailPrice,
            discountAmount: item.discountAmount,
            taxAmount: 0,
            unitCost: 0,
            lineCost: 0,
            lineSubtotal: item.quantity.toNumber() * item.unitPrice.toNumber(),
            lineTotal: item.lineTotal,
            notes: null
          }
        });
      }

      const updatedQuote = await tx.wholesaleQuotation.update({
        where: { id },
        data: { status: WholesaleQuotationStatus.CONVERTED_TO_ORDER }
      });

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: quote.branchId,
        userId: auth.userId,
        action: "quotation.convert",
        entityType: "WholesaleQuotation",
        entityId: quote.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: quote,
        afterData: updatedQuote
      }, tx);

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: order.branchId,
        userId: auth.userId,
        action: "wholesale_order.create",
        entityType: "Sale",
        entityId: order.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: order
      }, tx);

      return order;
    });
  },

  async approveOrder(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const order = await tx.sale.findFirst({
        where: {
          id,
          ...getSalesWhere(auth),
          saleType: SaleType.WHOLESALE,
          status: SaleStatus.DRAFT
        },
        include: { items: true }
      });

      if (!order) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Wholesale order not found", StatusCodes.NOT_FOUND);
      }

      // Transition to CONFIRMED (which means Approved/Reserved)
      const updated = await tx.sale.update({
        where: { id },
        data: { status: SaleStatus.CONFIRMED }
      });

      // Create stock reservations
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days expiry
      for (const item of order.items) {
        await inventoryWriteService.reserveStock(tx, {
          organizationId: order.organizationId,
          branchId: order.branchId,
          productVariantId: item.productVariantId,
          quantity: Number(item.quantity),
          sourceType: "SaleItem",
          sourceId: item.id,
          expiresAt
        });
      }

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: order.branchId,
        userId: auth.userId,
        action: "wholesale_order.approve",
        entityType: "Sale",
        entityId: order.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: order,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async fulfilOrder(auth: AuthContext, id: string, input: any, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const order = await tx.sale.findFirst({
        where: {
          id,
          ...getSalesWhere(auth),
          saleType: SaleType.WHOLESALE,
          status: SaleStatus.CONFIRMED
        },
        include: { items: true }
      });

      if (!order) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Wholesale order not found or not approved", StatusCodes.NOT_FOUND);
      }

      let totalCOGS = 0;

      for (const fulfillItem of input.items) {
        const orderItem = order.items.find(i => i.productVariantId === fulfillItem.productVariantId);
        if (!orderItem) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, `Product variant ${fulfillItem.productVariantId} is not in the order`, StatusCodes.BAD_REQUEST);
        }

        const qtyToFulfill = Number(fulfillItem.quantity);
        if (qtyToFulfill <= 0) continue;

        // Find active reservation for this item
        const reservation = await tx.inventoryReservation.findFirst({
          where: {
            organizationId: order.organizationId,
            branchId: order.branchId,
            productVariantId: fulfillItem.productVariantId,
            sourceType: "SaleItem",
            sourceId: orderItem.id,
            status: InventoryReservationStatus.ACTIVE
          }
        });

        if (!reservation) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, `No active reservation found for variant ${fulfillItem.productVariantId}`, StatusCodes.BAD_REQUEST);
        }

        const resQty = Number(reservation.quantity);
        if (qtyToFulfill > resQty) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, `Cannot fulfill ${qtyToFulfill} which is greater than reserved ${resQty}`, StatusCodes.BAD_REQUEST);
        }

        const currentBalance = await inventoryWriteService.lockBalance(tx, order.organizationId, order.branchId, fulfillItem.productVariantId);

        // Update reservation quantity
        const remainingResQty = resQty - qtyToFulfill;
        if (remainingResQty === 0) {
          await tx.inventoryReservation.update({
            where: { id: reservation.id },
            data: {
              status: InventoryReservationStatus.FULFILLED,
              fulfilledAt: new Date()
            }
          });
        } else {
          await tx.inventoryReservation.update({
            where: { id: reservation.id },
            data: { quantity: remainingResQty }
          });
        }

        // Decrement from inventory balance (onHand and reserved)
        await tx.inventoryBalance.update({
          where: { id: currentBalance.id },
          data: {
            quantityOnHand: { decrement: qtyToFulfill },
            quantityReserved: { decrement: qtyToFulfill }
          }
        });

        // Deduct from batches using FIFO
        const allocations = await inventoryWriteService.deductFromBatchesFIFO(tx, {
          organizationId: order.organizationId,
          branchId: order.branchId,
          productVariantId: fulfillItem.productVariantId,
          quantity: qtyToFulfill
        });

        // Calculate COGS
        let itemCOGS = 0;
        for (const alloc of allocations) {
          itemCOGS += alloc.quantityAllocated * alloc.landedUnitCost;
          
          await tx.saleItemBatch.upsert({
            where: { saleItemId_inventoryBatchId: { saleItemId: orderItem.id, inventoryBatchId: alloc.batchId } },
            update: {
              quantity: { increment: alloc.quantityAllocated },
              lineCost: { increment: alloc.quantityAllocated * alloc.landedUnitCost }
            },
            create: {
              saleItemId: orderItem.id, inventoryBatchId: alloc.batchId,
              quantity: alloc.quantityAllocated, unitCost: alloc.unitCost,
              lineCost: alloc.quantityAllocated * alloc.landedUnitCost
            }
          });
        }
        totalCOGS += itemCOGS;

        await tx.inventoryMovement.create({
          data: {
            organizationId: order.organizationId,
            branchId: order.branchId,
            productVariantId: orderItem.productVariantId,
            movementNumber: `MVT-WS-${Date.now()}-${orderItem.id.slice(-6).toUpperCase()}`,
            movementType: InventoryMovementType.SALE,
            referenceType: "SaleItem",
            referenceId: orderItem.id,
            quantity: -qtyToFulfill,
            unitCost: qtyToFulfill > 0 ? itemCOGS / qtyToFulfill : 0,
            totalCost: -itemCOGS,
            quantityBefore: currentBalance.quantityOnHand,
            quantityAfter: Number(currentBalance.quantityOnHand) - qtyToFulfill,
            performedById: auth.userId,
            reason: `Wholesale fulfilment ${order.saleNumber}`
          }
        });

        // Update SaleItem unitCost and lineCost
        const oldCost = Number(orderItem.lineCost);
        const newCost = oldCost + itemCOGS;
        await tx.saleItem.update({
          where: { id: orderItem.id },
          data: {
            lineCost: newCost,
            unitCost: orderItem.quantity.toNumber() > 0 ? (newCost / orderItem.quantity.toNumber()) : 0
          }
        });
      }

      // Check current overall fulfilment status
      // We look at all inventory movements for this order's items to count fulfilled
      const itemsFulfilledCount = await Promise.all(order.items.map(async (item) => {
        const movements = await tx.inventoryMovement.findMany({
          where: {
            referenceType: "SaleItem",
            referenceId: item.id,
            movementType: "SALE"
          }
        });
        const fulfilled = movements.reduce((sum, m) => sum + Math.abs(Number(m.quantity)), 0);
        return { itemId: item.id, ordered: Number(item.quantity), fulfilled };
      }));

      const isFullyFulfilled = itemsFulfilledCount.every(x => x.fulfilled >= x.ordered);
      const isPartiallyFulfilled = itemsFulfilledCount.some(x => x.fulfilled > 0);

      let fulfillmentStatus = "PENDING";
      let status = order.status;
      if (isFullyFulfilled) {
        fulfillmentStatus = "FULFILLED";
        status = SaleStatus.COMPLETED; // transition to completed
      } else if (isPartiallyFulfilled) {
        fulfillmentStatus = "PARTIAL";
      }

      const updated = await tx.sale.update({
        where: { id },
        data: {
          status,
          fulfillmentStatus,
          costOfGoodsSold: { increment: totalCOGS },
          grossProfit: order.totalAmount.toNumber() - (Number(order.costOfGoodsSold) + totalCOGS),
          completedAt: isFullyFulfilled ? new Date() : order.completedAt
        }
      });

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: order.branchId,
        userId: auth.userId,
        action: "wholesale_order.fulfil",
        entityType: "Sale",
        entityId: order.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: order,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async invoiceOrder(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const order = await tx.sale.findFirst({
        where: {
          id,
          ...getSalesWhere(auth),
          saleType: SaleType.WHOLESALE
        },
        include: {
          items: true,
          invoices: true,
          branch: { select: { id: true, code: true } }
        }
      });

      if (!order) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Wholesale order not found", StatusCodes.NOT_FOUND);
      }

      if (order.invoices.length > 0) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Wholesale order has already been invoiced", StatusCodes.BAD_REQUEST);
      }
      if (order.status !== SaleStatus.COMPLETED || order.fulfillmentStatus !== "FULFILLED") {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Wholesale order must be fully fulfilled before invoicing", StatusCodes.CONFLICT);
      }

      const issueDate = new Date();
      const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      const invoiceNumber = await reserveInvoiceDocumentNumber(tx, {
        organizationId: scope.organizationId,
        branchId: order.branchId,
        branchCode: order.branch.code,
        issuedAt: issueDate,
        kind: "INVOICE"
      });

      const invoice = await tx.invoice.create({
        data: {
          organizationId: scope.organizationId,
          branchId: order.branchId,
          invoiceNumber,
          saleId: order.id,
          customerId: order.customerId,
          createdById: auth.userId,
          invoiceType: InvoiceType.WHOLESALE,
          source: InvoiceSource.WHOLESALE_ORDER,
          status: InvoiceStatus.SENT,
          currencyCode: order.currencyCode,
          paymentTermsDays: 30,
          issueDate,
          dueDate,
          issuedAt: issueDate,
          subtotal: order.subtotal,
          discountAmount: order.lineDiscountAmount,
          taxAmount: order.taxAmount,
          totalAmount: order.totalAmount,
          amountPaid: order.amountPaid,
          amountDue: order.amountDue
        }
      });
      if (order.customerId && Number(order.amountDue) > 0) {
        await postCustomerBalanceEntry(tx, {
          organizationId: scope.organizationId, branchId: order.branchId, customerId: order.customerId,
          amount: Number(order.amountDue), entryType: "INVOICE", referenceType: "Invoice", referenceId: invoice.id,
          notes: `Invoice ${invoice.invoiceNumber}`, createdById: auth.userId
        });
      }

      for (const item of order.items) {
        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal
          }
        });
      }

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: order.branchId,
        userId: auth.userId,
        action: "invoice.create",
        entityType: "Invoice",
        entityId: invoice.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: invoice
      }, tx);

      return invoice;
    });
  },

  async cancelOrder(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const order = await tx.sale.findFirst({
        where: {
          id,
          ...getSalesWhere(auth),
          saleType: SaleType.WHOLESALE
        },
        include: { items: true }
      });

      if (!order) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Wholesale order not found", StatusCodes.NOT_FOUND);
      }

      if (order.status === SaleStatus.CANCELLED || order.status === SaleStatus.VOIDED) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Wholesale order is already cancelled or voided", StatusCodes.BAD_REQUEST);
      }

      // Release active reservations
      const reservations = await tx.inventoryReservation.findMany({
        where: {
          organizationId: order.organizationId,
          branchId: order.branchId,
          sourceType: "SaleItem",
          sourceId: { in: order.items.map(i => i.id) },
          status: InventoryReservationStatus.ACTIVE
        }
      });

      for (const res of reservations) {
        await inventoryWriteService.releaseReservation(tx, res.id);
      }

      const updated = await tx.sale.update({
        where: { id },
        data: {
          status: SaleStatus.CANCELLED,
          fulfillmentStatus: "CANCELLED"
        }
      });

      await auditService.create({
        organizationId: scope.organizationId,
        branchId: order.branchId,
        userId: auth.userId,
        action: "wholesale_order.cancel",
        entityType: "Sale",
        entityId: order.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: order,
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async payInvoice(auth: AuthContext, id: string, input: any, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      
      const invoice = await tx.invoice.findFirst({
        where: {
          id,
          organizationId: scope.organizationId,
          ...(auth.role === UserRole.SALES_ATTENDANT
            ? { sale: { attendantId: auth.userId } }
            : scope.branchIds
              ? { sale: { branchId: { in: scope.branchIds } } }
              : {})
        },
        include: { sale: true }
      });

      if (!invoice) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Invoice not found", StatusCodes.NOT_FOUND);
      }

      if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.VOIDED || invoice.invoiceType === InvoiceType.PRO_FORMA) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Only issued receivable invoices can accept payments", StatusCodes.BAD_REQUEST);
      }

      const pmtAmount = Number(input.amount);
      if (pmtAmount > Number(invoice.amountDue) + 0.01) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Payment allocation cannot exceed the invoice amount due", StatusCodes.BAD_REQUEST);
      }
      const amountPaid = Number(invoice.amountPaid) + pmtAmount;
      const amountDue = Math.max(0, Number(invoice.amountDue) - pmtAmount);
      const nextStatus = amountDue <= 0 ? "PAID" : "PARTIALLY_PAID";

      const count = await tx.payment.count({
        where: { organizationId: scope.organizationId }
      });
      const paymentNumber = `PMT-${(count + 1).toString().padStart(6, "0")}`;

      const branchId = invoice.branchId ?? invoice.sale?.branchId;
      if (!branchId) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Invoice is not linked to a branch", StatusCodes.BAD_REQUEST);
      }
      const activeShift = await tx.shift.findFirst({
        where: {
          organizationId: scope.organizationId,
          branchId,
          userId: auth.userId,
          status: "OPEN"
        }
      });
      if (input.paymentMethod === "CASH" && !activeShift) {
        throw new AppError(ERROR_CODES.SHIFT_NOT_OPEN, "Cash payment requires an open shift", StatusCodes.CONFLICT);
      }
      if (input.reference) {
        const duplicate = await tx.payment.findFirst({
          where: {
            organizationId: scope.organizationId,
            paymentMethod: input.paymentMethod,
            reference: input.reference,
            status: { notIn: ["FAILED", "CANCELLED", "REVERSED"] }
          }
        });
        if (duplicate) {
          throw new AppError(ERROR_CODES.DUPLICATE_IDEMPOTENCY_KEY, "Payment reference has already been used", StatusCodes.CONFLICT);
        }
      }
      if (input.paymentMethod === "MPESA") {
        const verified = await tx.mpesaTransaction.findFirst({
          where: {
            organizationId: scope.organizationId,
            branchId,
            status: "SUCCESS",
            mpesaReceiptNumber: input.reference,
            amount: pmtAmount,
            paymentId: null
          }
        });
        if (!verified) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "M-Pesa payment has not been verified", StatusCodes.CONFLICT);
        }
      }

      const payment = await tx.payment.create({
        data: {
          organizationId: scope.organizationId,
          branchId,
          paymentNumber,
          customerId: invoice.customerId,
          saleId: invoice.saleId ?? null,
          shiftId: activeShift?.id ?? null,
          direction: "INCOMING",
          paymentMethod: input.paymentMethod,
          amount: pmtAmount,
          currencyCode: invoice.currencyCode,
          reference: input.reference || null,
          status: "COMPLETED",
          receivedById: auth.userId,
          receivedAt: new Date()
        }
      });

      if (input.paymentMethod === "MPESA") {
        await tx.mpesaTransaction.update({
          where: { mpesaReceiptNumber: input.reference },
          data: { saleId: invoice.saleId, paymentId: payment.id, customerId: invoice.customerId }
        });
      }

      await tx.invoicePaymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: pmtAmount
        }
      });

      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid,
          amountDue,
          status: nextStatus as InvoiceStatus
        }
      });

      if (invoice.sale) {
        const saleAmountPaid = Number(invoice.sale.amountPaid) + pmtAmount;
        const saleAmountDue = Math.max(0, Number(invoice.sale.amountDue) - pmtAmount);
        const salePaymentStatus = saleAmountDue <= 0 ? "PAID" : "PARTIALLY_PAID";

        await tx.sale.update({
          where: { id: invoice.sale.id },
          data: {
            amountPaid: saleAmountPaid,
            amountDue: saleAmountDue,
            paymentStatus: salePaymentStatus
          }
        });
      }

      if (invoice.customerId) {
        await postCustomerBalanceEntry(tx, {
          organizationId: scope.organizationId, branchId, customerId: invoice.customerId,
          amount: -pmtAmount, entryType: "PAYMENT", referenceType: "Payment", referenceId: payment.id,
          notes: `Invoice payment ${payment.paymentNumber}`, createdById: auth.userId
        });
      }

      await auditService.create({
        organizationId: scope.organizationId,
        branchId,
        userId: auth.userId,
        action: "invoice.pay",
        entityType: "Invoice",
        entityId: invoice.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        beforeData: invoice,
        afterData: updatedInvoice
      }, tx);

      return updatedInvoice;
    });
  },

  async generateInvoice(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id, ...getSalesWhere(auth) },
        include: {
          items: true,
          invoices: true,
          customer: true,
          branch: { select: { id: true, code: true } }
        }
      });

      if (!sale) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Sale not found", StatusCodes.NOT_FOUND);
      }

      if (!(completedSaleStatuses as SaleStatus[]).includes(sale.status)) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Only completed sales can generate invoices", StatusCodes.BAD_REQUEST);
      }

      if (sale.invoices.length > 0) {
        const existingInvoiceId = sale.invoices[0]?.id;
        if (!existingInvoiceId) {
          throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Existing invoice could not be resolved", StatusCodes.NOT_FOUND);
        }
        return tx.invoice.findFirstOrThrow({
          where: { id: existingInvoiceId },
          include: {
            customer: true,
            sale: { include: { branch: true } },
            items: true,
            allocations: { include: { payment: true } }
          }
        });
      }

      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + Number(sale.customer?.paymentTermsDays ?? 0));
      const invoiceStatus = Number(sale.amountDue) <= 0
        ? InvoiceStatus.PAID
        : Number(sale.amountPaid) > 0
          ? InvoiceStatus.PARTIALLY_PAID
          : InvoiceStatus.SENT;
      const invoiceNumber = await reserveInvoiceDocumentNumber(tx, {
        organizationId: auth.organizationId,
        branchId: sale.branchId,
        branchCode: sale.branch.code,
        issuedAt: issueDate,
        kind: "INVOICE"
      });

      const invoice = await tx.invoice.create({
        data: {
          organizationId: auth.organizationId,
          branchId: sale.branchId,
          invoiceNumber,
          saleId: sale.id,
          customerId: sale.customerId,
          createdById: auth.userId,
          invoiceType: sale.saleType === SaleType.WHOLESALE ? InvoiceType.WHOLESALE : InvoiceType.STANDARD,
          source: InvoiceSource.COMPLETED_SALE,
          status: invoiceStatus,
          currencyCode: sale.currencyCode,
          paymentTermsDays: Number(sale.customer?.paymentTermsDays ?? 0),
          issueDate,
          dueDate,
          issuedAt: issueDate,
          subtotal: sale.subtotal,
          discountAmount: Number(sale.lineDiscountAmount) + Number(sale.orderDiscountAmount),
          taxAmount: sale.taxAmount,
          totalAmount: sale.totalAmount,
          amountPaid: sale.amountPaid,
          amountDue: sale.amountDue,
          notes: sale.notes
        }
      });

      for (const item of sale.items) {
        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal
          }
        });
      }

      const completedPayments = await tx.payment.findMany({
        where: { saleId: sale.id, status: "COMPLETED" }
      });
      for (const payment of completedPayments) {
        await tx.invoicePaymentAllocation.create({
          data: {
            invoiceId: invoice.id,
            paymentId: payment.id,
            amount: payment.amount
          }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: sale.branchId,
        userId: auth.userId,
        action: "invoice.create",
        entityType: "Invoice",
        entityId: invoice.id,
        requestId: request.requestContext?.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: invoice
      }, tx);

      return tx.invoice.findFirstOrThrow({
        where: { id: invoice.id },
        include: {
          customer: true,
          sale: { include: { branch: true } },
          items: true,
          allocations: { include: { payment: true } }
        }
      });
    });
  },

  async listDiscountRequests(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const where: Prisma.DiscountRequestWhereInput = { organizationId: scope.organizationId };
    if (scope.branchIds) where.branchId = { in: scope.branchIds };
    if (auth.role === UserRole.SALES_ATTENDANT) where.requestedById = auth.userId;
    if (query.branchId) { assertBranchAccess(auth, query.branchId); where.branchId = query.branchId; }
    if (query.status) where.status = query.status;
    return prisma.discountRequest.findMany({ where, orderBy: { createdAt: "desc" } });
  },

  async createDiscountRequest(auth: AuthContext, input: Record<string, any>, request: Request) {
    assertBranchAccess(auth, input.branchId);
    const existing = await prisma.discountRequest.findFirst({
      where: { organizationId: auth.organizationId, branchId: input.branchId, cartReference: input.cartReference, status: { in: ["PENDING", "APPROVED"] } }
    });
    if (existing) return existing;
    const created = await prisma.discountRequest.create({
      data: {
        organizationId: auth.organizationId,
        branchId: input.branchId,
        cartReference: input.cartReference,
        requestedPercent: input.requestedPercent ?? null,
        requestedAmount: input.requestedAmount ?? null,
        reason: input.reason,
        requestedById: auth.userId,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
      }
    });
    await auditService.create({
      organizationId: auth.organizationId, branchId: input.branchId, userId: auth.userId,
      action: "discount.request", entityType: "DiscountRequest", entityId: created.id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), afterData: created
    });
    return created;
  },

  async approveDiscountRequest(auth: AuthContext, id: string, request: Request) {
    const scope = buildUserScope(auth);
    const discount = await prisma.discountRequest.findFirst({
      where: { id, organizationId: scope.organizationId, ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}) }
    });
    if (!discount) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Discount request not found", StatusCodes.NOT_FOUND);
    if (discount.status !== "PENDING") throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Discount request is not pending", StatusCodes.CONFLICT);
    if (discount.requestedById === auth.userId) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "A requester cannot approve their own discount", StatusCodes.FORBIDDEN);
    }
    if (auth.role === UserRole.BRANCH_MANAGER) {
      const settings = await prisma.organizationSetting.findUnique({ where: { organizationId: auth.organizationId } });
      const limit = Number(settings?.maximumBranchManagerDiscount ?? 0);
      if (Number(discount.requestedPercent ?? Number.POSITIVE_INFINITY) > limit) {
        throw new AppError(ERROR_CODES.ACCESS_DENIED, "Discount exceeds the Branch Manager approval limit", StatusCodes.FORBIDDEN);
      }
    }
    const updated = await prisma.discountRequest.update({
      where: { id },
      data: { status: "APPROVED", approvedById: auth.userId, reviewedAt: new Date() }
    });
    await auditService.create({
      organizationId: auth.organizationId, branchId: discount.branchId, userId: auth.userId,
      action: "discount.approve", entityType: "DiscountRequest", entityId: id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: discount, afterData: updated
    });
    return updated;
  },

  async rejectDiscountRequest(auth: AuthContext, id: string, reason: string, request: Request) {
    const scope = buildUserScope(auth);
    const discount = await prisma.discountRequest.findFirst({
      where: { id, organizationId: scope.organizationId, ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}) }
    });
    if (!discount) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Discount request not found", StatusCodes.NOT_FOUND);
    if (discount.status !== "PENDING") throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Discount request is not pending", StatusCodes.CONFLICT);
    const updated = await prisma.discountRequest.update({
      where: { id },
      data: { status: "REJECTED", rejectedById: auth.userId, reviewedAt: new Date(), reason: `${discount.reason}\nRejected: ${reason}` }
    });
    await auditService.create({
      organizationId: auth.organizationId, branchId: discount.branchId, userId: auth.userId,
      action: "discount.reject", entityType: "DiscountRequest", entityId: id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: discount, afterData: updated
    });
    return updated;
  }
};
