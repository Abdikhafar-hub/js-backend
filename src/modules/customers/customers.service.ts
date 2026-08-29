import { CustomerStatus, CustomerType, Prisma, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { prisma } from "../../lib/prisma.js";
import { auditService } from "../../services/audit.service.js";
import type { AuthContext } from "../../types/auth.js";

type CustomerQuery = {
  page?: string;
  limit?: string;
  search?: string;
  customerType?: string;
  status?: string;
  creditAllowed?: string;
  branchId?: string;
  preferredBranchId?: string;
};

type CustomerInput = Partial<Record<
  "customerType" | "firstName" | "lastName" | "businessName" | "phone" | "alternatePhone" |
  "email" | "taxNumber" | "address" | "city" | "county" | "preferredBranchId" |
  "creditAllowed" | "creditLimit" | "paymentTermsDays" | "notes" | "status",
  unknown
>>;

const branchRelevance = (branchIds: string[]): Prisma.CustomerWhereInput => ({
  OR: [
    { preferredBranchId: { in: branchIds } },
    { sales: { some: { branchId: { in: branchIds } } } },
    { payments: { some: { branchId: { in: branchIds } } } },
    { wholesaleQuotations: { some: { branchId: { in: branchIds } } } },
    { invoices: { some: { sale: { branchId: { in: branchIds } } } } }
  ]
});

export const buildCustomerAccessWhere = (auth: AuthContext, query: CustomerQuery = {}): Prisma.CustomerWhereInput => {
  const scope = buildUserScope(auth);
  if (query.branchId) assertBranchAccess(auth, query.branchId);
  if (query.preferredBranchId) assertBranchAccess(auth, query.preferredBranchId);

  const filters: Prisma.CustomerWhereInput[] = [];
  if (scope.branchIds) filters.push(branchRelevance(scope.branchIds));
  if (query.branchId) filters.push(branchRelevance([query.branchId]));
  if (query.search) {
    filters.push({
      OR: [
        { firstName: { contains: query.search, mode: "insensitive" } },
        { lastName: { contains: query.search, mode: "insensitive" } },
        { businessName: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search } },
        { customerNumber: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } }
      ]
    });
  }

  return {
    organizationId: scope.organizationId,
    ...(query.customerType ? { customerType: query.customerType as CustomerType } : {}),
    ...(query.status ? { status: query.status as CustomerStatus } : {}),
    ...(query.creditAllowed !== undefined && auth.role === UserRole.GENERAL_MANAGER
      ? { creditAllowed: query.creditAllowed === "true" }
      : {}),
    ...(query.preferredBranchId ? { preferredBranchId: query.preferredBranchId } : {}),
    ...(filters.length ? { AND: filters } : {})
  };
};

export const shapeCustomerForRole = <T extends Record<string, unknown>>(auth: AuthContext, customer: T) => {
  if (auth.role === UserRole.GENERAL_MANAGER) return customer;

  if (auth.role === UserRole.BRANCH_MANAGER) {
    const {
      creditAllowed: _creditAllowed, creditLimit: _creditLimit, paymentTermsDays: _paymentTermsDays,
      currentOutstandingBalance: _globalOutstanding, taxNumber: _taxNumber, notes: _notes,
      notesHistory: _notesHistory, branchScopedOutstandingBalance, ...branchView
    } = customer;
    return branchScopedOutstandingBalance === undefined
      ? branchView
      : { ...branchView, currentOutstandingBalance: branchScopedOutstandingBalance };
  }

  const safeKeys = [
    "id", "customerNumber", "customerType", "firstName", "lastName", "businessName", "phone",
    "alternatePhone", "email", "preferredBranchId", "preferredBranch", "loyaltyPointsBalance",
    "status", "lastPurchaseAt", "createdAt", "updatedAt"
  ];
  return Object.fromEntries(Object.entries(customer).filter(([key]) => safeKeys.includes(key)));
};

const customerTypeForCreate = (auth: AuthContext, value: unknown) => {
  const customerType = value as CustomerType;
  if (auth.role === UserRole.BRANCH_MANAGER && customerType === CustomerType.VIP) {
    throw new AppError(ERROR_CODES.ACCESS_DENIED, "VIP classification requires organization credit authority", StatusCodes.FORBIDDEN);
  }
  if (
    auth.role === UserRole.SALES_ATTENDANT &&
    !([CustomerType.WALK_IN, CustomerType.RETAIL, CustomerType.WHOLESALE] as CustomerType[]).includes(customerType)
  ) {
    throw new AppError(ERROR_CODES.ACCESS_DENIED, "Sales attendants can create retail customers or wholesale leads only", StatusCodes.FORBIDDEN);
  }
  return customerType;
};

const assignedCreationBranch = (auth: AuthContext, requested: unknown) => {
  if (auth.role === UserRole.GENERAL_MANAGER) return typeof requested === "string" && requested ? requested : null;
  const branchId = typeof requested === "string" && requested ? requested : auth.branchIds[0];
  if (!branchId) throw new AppError(ERROR_CODES.BRANCH_ACCESS_DENIED, "An assigned branch is required", StatusCodes.FORBIDDEN);
  assertBranchAccess(auth, branchId);
  return branchId;
};

const findAccessibleCustomer = async (auth: AuthContext, id: string) => {
  const customer = await prisma.customer.findFirst({ where: { id, ...buildCustomerAccessWhere(auth) } });
  if (!customer) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer not found", StatusCodes.NOT_FOUND);
  return customer;
};

export const customersService = {
  async listCustomers(auth: AuthContext, query: CustomerQuery) {
    const where = buildCustomerAccessWhere(auth, query);
    const page = Math.max(1, Number.parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || "20", 10)));
    const scopedSaleWhere = auth.role === UserRole.GENERAL_MANAGER ? {} : { branchId: { in: auth.branchIds } };
    const [total, records] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          preferredBranch: { select: { id: true, name: true } },
          sales: { where: scopedSaleWhere, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } }
        }
      })
    ]);

    const branchBalances = auth.role === UserRole.BRANCH_MANAGER && records.length
      ? await prisma.invoice.groupBy({
          by: ["customerId"],
          where: {
            customerId: { in: records.map((record) => record.id) },
            sale: { branchId: { in: auth.branchIds } }
          },
          _sum: { amountDue: true }
        })
      : [];
    const branchBalanceByCustomer = new Map(
      branchBalances.flatMap((balance) => balance.customerId
        ? [[balance.customerId, balance._sum.amountDue ?? new Prisma.Decimal(0)] as const]
        : [])
    );

    const items = records.map(({ sales, ...record }) =>
      shapeCustomerForRole(auth, {
        ...record,
        ...(auth.role === UserRole.BRANCH_MANAGER
          ? { branchScopedOutstandingBalance: branchBalanceByCustomer.get(record.id) ?? new Prisma.Decimal(0) }
          : {}),
        lastPurchaseAt: sales[0]?.createdAt ?? null
      })
    );
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  },

  async getCustomer(auth: AuthContext, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, ...buildCustomerAccessWhere(auth) },
      include: {
        preferredBranch: { select: { id: true, name: true } },
        addresses: auth.role !== UserRole.SALES_ATTENDANT,
        notesHistory: auth.role === UserRole.GENERAL_MANAGER
      }
    });
    if (!customer) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer not found", StatusCodes.NOT_FOUND);
    if (auth.role !== UserRole.BRANCH_MANAGER) {
      return shapeCustomerForRole(auth, customer as unknown as Record<string, unknown>);
    }
    const branchBalance = await prisma.invoice.aggregate({
      where: { customerId: customer.id, sale: { branchId: { in: auth.branchIds } } },
      _sum: { amountDue: true }
    });
    return shapeCustomerForRole(auth, {
      ...customer,
      branchScopedOutstandingBalance: branchBalance._sum.amountDue ?? new Prisma.Decimal(0)
    } as unknown as Record<string, unknown>);
  },

  async createCustomer(auth: AuthContext, input: CustomerInput, request: Request) {
    const preferredBranchId = assignedCreationBranch(auth, input.preferredBranchId);
    if (input.phone) {
      const duplicate = await prisma.customer.findFirst({ where: { organizationId: auth.organizationId, phone: String(input.phone) }, select: { id: true } });
      if (duplicate) throw new AppError(ERROR_CODES.BAD_REQUEST, "A customer with this phone number already exists", StatusCodes.CONFLICT);
    }

    return prisma.$transaction(async (tx) => {
      const count = await tx.customer.count({ where: { organizationId: auth.organizationId } });
      const canManageCredit = auth.role === UserRole.GENERAL_MANAGER;
      const customer = await tx.customer.create({
        data: {
          organizationId: auth.organizationId,
          customerNumber: `CUST-${String(count + 1).padStart(6, "0")}`,
          customerType: customerTypeForCreate(auth, input.customerType),
          firstName: input.firstName as string | null | undefined,
          lastName: input.lastName as string | null | undefined,
          businessName: input.businessName as string | null | undefined,
          phone: input.phone as string | null | undefined,
          alternatePhone: input.alternatePhone as string | null | undefined,
          email: input.email as string | null | undefined,
          address: input.address as string | null | undefined,
          city: input.city as string | null | undefined,
          county: input.county as string | null | undefined,
          preferredBranchId,
          taxNumber: canManageCredit ? input.taxNumber as string | null | undefined : null,
          creditAllowed: canManageCredit ? Boolean(input.creditAllowed) : false,
          creditLimit: new Prisma.Decimal(canManageCredit ? Number(input.creditLimit || 0) : 0),
          paymentTermsDays: canManageCredit ? Number(input.paymentTermsDays || 0) : 0,
          notes: canManageCredit ? input.notes as string | null | undefined : null,
          status: canManageCredit && input.status ? input.status as CustomerStatus : CustomerStatus.ACTIVE
        }
      });
      await auditService.create({
        organizationId: auth.organizationId, branchId: preferredBranchId, userId: auth.userId,
        action: "customer.create", entityType: "Customer", entityId: customer.id,
        requestId: request.requestContext?.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), afterData: customer
      }, tx);
      return shapeCustomerForRole(auth, customer as unknown as Record<string, unknown>);
    });
  },

  async updateCustomer(auth: AuthContext, id: string, input: CustomerInput, request: Request) {
    const existing = await findAccessibleCustomer(auth, id);
    return prisma.$transaction(async (tx) => {
      const gm = auth.role === UserRole.GENERAL_MANAGER;
      const updated = await tx.customer.update({
        where: { id: existing.id },
        data: {
          customerType: input.customerType ? customerTypeForCreate(auth, input.customerType) : undefined,
          firstName: input.firstName as string | null | undefined,
          lastName: input.lastName as string | null | undefined,
          businessName: input.businessName as string | null | undefined,
          phone: input.phone as string | null | undefined,
          alternatePhone: input.alternatePhone as string | null | undefined,
          email: input.email as string | null | undefined,
          address: input.address as string | null | undefined,
          city: input.city as string | null | undefined,
          county: input.county as string | null | undefined,
          preferredBranchId: gm && input.preferredBranchId !== undefined
            ? assignedCreationBranch(auth, input.preferredBranchId)
            : undefined,
          taxNumber: gm ? input.taxNumber as string | null | undefined : undefined,
          notes: gm ? input.notes as string | null | undefined : undefined,
          status: gm ? input.status as CustomerStatus | undefined : undefined
        }
      });
      await auditService.create({
        organizationId: auth.organizationId, branchId: updated.preferredBranchId, userId: auth.userId,
        action: "customer.update", entityType: "Customer", entityId: updated.id,
        requestId: request.requestContext?.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), beforeData: existing, afterData: updated
      }, tx);
      return shapeCustomerForRole(auth, updated as unknown as Record<string, unknown>);
    });
  },

  async updateCredit(auth: AuthContext, id: string, input: { creditAllowed: boolean; creditLimit: number; paymentTermsDays: number }, request: Request) {
    const existing = await findAccessibleCustomer(auth, id);
    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: { creditAllowed: input.creditAllowed, creditLimit: new Prisma.Decimal(input.creditLimit), paymentTermsDays: input.paymentTermsDays }
    });
    await auditService.create({
      organizationId: auth.organizationId, branchId: updated.preferredBranchId, userId: auth.userId,
      action: "customer.credit.update", entityType: "Customer", entityId: updated.id,
      requestId: request.requestContext?.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: existing, afterData: updated
    });
    return updated;
  },

  async getCustomerSales(auth: AuthContext, id: string, query: CustomerQuery) {
    await findAccessibleCustomer(auth, id);
    const page = Math.max(1, Number.parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || "20", 10)));
    const where: Prisma.SaleWhereInput = {
      customerId: id, organizationId: auth.organizationId,
      ...(auth.role === UserRole.GENERAL_MANAGER ? {} : { branchId: { in: auth.branchIds } })
    };
    const [total, items] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" },
        select: {
          id: true, saleNumber: true, saleType: true, status: true, paymentStatus: true,
          fulfillmentStatus: true, totalAmount: true, createdAt: true,
          branch: { select: { id: true, name: true } }
        }
      })
    ]);
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  },

  async getCustomerInvoices(auth: AuthContext, id: string, query: CustomerQuery) {
    await findAccessibleCustomer(auth, id);
    const page = Math.max(1, Number.parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || "20", 10)));
    const where: Prisma.InvoiceWhereInput = {
      customerId: id, organizationId: auth.organizationId,
      ...(auth.role === UserRole.GENERAL_MANAGER ? {} : { sale: { branchId: { in: auth.branchIds } } })
    };
    const [total, items] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" }, include: { sale: { include: { branch: { select: { id: true, name: true } } } } } })
    ]);
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  },

  async getCustomerQuotations(auth: AuthContext, id: string, query: CustomerQuery) {
    await findAccessibleCustomer(auth, id);
    const page = Math.max(1, Number.parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || "20", 10)));
    const where: Prisma.WholesaleQuotationWhereInput = {
      customerId: id, organizationId: auth.organizationId,
      ...(auth.role === UserRole.GENERAL_MANAGER ? {} : { branchId: { in: auth.branchIds } })
    };
    const [total, items] = await Promise.all([
      prisma.wholesaleQuotation.count({ where }),
      prisma.wholesaleQuotation.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" }, include: { branch: { select: { id: true, name: true } } } })
    ]);
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  },

  async getCustomerLedger(auth: AuthContext, id: string) {
    await findAccessibleCustomer(auth, id);
    return prisma.customer.findFirst({
      where: { id, organizationId: auth.organizationId },
      select: {
        id: true, customerNumber: true, currentOutstandingBalance: true, creditAllowed: true,
        creditLimit: true, paymentTermsDays: true,
        payments: { orderBy: { createdAt: "desc" }, take: 100 },
        creditNotes: { orderBy: { createdAt: "desc" }, take: 100 },
        debitNotes: { orderBy: { createdAt: "desc" }, take: 100 },
        loyaltyLedger: { orderBy: { createdAt: "desc" }, take: 100 }
      }
    });
  }
};
