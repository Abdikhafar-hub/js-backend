import { prisma } from "../../lib/prisma.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";
import { Prisma } from "@prisma/client";

const scopeFilter = (auth: AuthContext) => {
  const scope = buildUserScope(auth);
  return { organizationId: scope.organizationId, branchIds: scope.branchIds };
};

const branchSQL = (branchIds: string[] | undefined) =>
  branchIds && branchIds.length > 0 ? Prisma.sql`AND "branchId" IN (${Prisma.join(branchIds)})` : Prisma.empty;

export const reportsService = {
  async getSalesReport(auth: AuthContext, startDate: Date, endDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const dailySales = await prisma.$queryRaw<any[]>`
      SELECT DATE_TRUNC('day', "createdAt") as day, COUNT(id)::int as "totalTransactions",
        COALESCE(SUM("totalAmount"), 0) as "totalRevenue", COALESCE(SUM("subtotal"), 0) as subtotal,
        COALESCE(SUM("lineDiscountAmount" + "orderDiscountAmount"), 0) as discounts, COALESCE(SUM("taxAmount"), 0) as taxes
      FROM "Sale" WHERE "organizationId" = ${organizationId} ${branchSQL(branchIds)}
        AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate} AND "status" = 'COMPLETED'
      GROUP BY DATE_TRUNC('day', "createdAt") ORDER BY day ASC`;

    const salesByCategory = await prisma.$queryRaw<any[]>`
      SELECT c.name as "categoryName", SUM(si.quantity)::int as "quantitySold", SUM(si."lineTotal") as "totalRevenue"
      FROM "SaleItem" si JOIN "Sale" s ON si."saleId" = s.id JOIN "ProductVariant" pv ON si."productVariantId" = pv.id
      JOIN "Product" p ON pv."productId" = p.id JOIN "ProductCategory" c ON p."categoryId" = c.id
      WHERE s."organizationId" = ${organizationId} ${branchIds && branchIds.length > 0 ? Prisma.sql`AND s."branchId" IN (${Prisma.join(branchIds)})` : Prisma.empty}
        AND s."createdAt" >= ${startDate} AND s."createdAt" <= ${endDate} AND s."status" = 'COMPLETED'
      GROUP BY c.name ORDER BY "totalRevenue" DESC`;
    return { dailySales, salesByCategory };
  },

  async getGrossProfitReport(auth: AuthContext, startDate: Date, endDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const profitByBranch = await prisma.$queryRaw<any[]>`
      SELECT b.name as "branchName", COALESCE(SUM(s."totalAmount"), 0) as revenue,
        COALESCE(SUM(s."costOfGoodsSold"), 0) as cogs, COALESCE(SUM(s."grossProfit"), 0) as "grossProfit",
        COUNT(s.id)::int as transactions
      FROM "Sale" s JOIN "Branch" b ON s."branchId" = b.id
      WHERE s."organizationId" = ${organizationId} ${branchIds && branchIds.length > 0 ? Prisma.sql`AND s."branchId" IN (${Prisma.join(branchIds)})` : Prisma.empty}
        AND s."createdAt" >= ${startDate} AND s."createdAt" <= ${endDate} AND s."status" = 'COMPLETED'
      GROUP BY b.name ORDER BY "grossProfit" DESC`;
    return { profitByBranch };
  },

  async getBranchReport(auth: AuthContext, startDate: Date, endDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const branches = await prisma.$queryRaw<any[]>`
      SELECT b.name as "branchName", b.id as "branchId", COUNT(s.id)::int as "transactionCount",
        COALESCE(SUM(s."totalAmount"), 0) as revenue, COALESCE(SUM(s."grossProfit"), 0) as "grossProfit",
        COALESCE(SUM(s."lineDiscountAmount" + s."orderDiscountAmount"), 0) as discounts
      FROM "Branch" b LEFT JOIN "Sale" s ON s."branchId" = b.id AND s."status" = 'COMPLETED'
        AND s."createdAt" >= ${startDate} AND s."createdAt" <= ${endDate}
      WHERE b."organizationId" = ${organizationId} ${branchIds && branchIds.length > 0 ? Prisma.sql`AND b.id IN (${Prisma.join(branchIds)})` : Prisma.empty}
      GROUP BY b.name, b.id ORDER BY revenue DESC`;
    return { branches };
  },

  async getProductReport(auth: AuthContext, startDate: Date, endDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const products = await prisma.$queryRaw<any[]>`
      SELECT p.name as "productName", pv.sku, SUM(si.quantity)::int as "unitsSold",
        SUM(si."lineTotal") as revenue, SUM(si."lineCost") as cogs
      FROM "SaleItem" si JOIN "Sale" s ON si."saleId" = s.id JOIN "ProductVariant" pv ON si."productVariantId" = pv.id
      JOIN "Product" p ON pv."productId" = p.id
      WHERE s."organizationId" = ${organizationId} ${branchIds && branchIds.length > 0 ? Prisma.sql`AND s."branchId" IN (${Prisma.join(branchIds)})` : Prisma.empty}
        AND s."createdAt" >= ${startDate} AND s."createdAt" <= ${endDate} AND s."status" = 'COMPLETED'
      GROUP BY p.name, pv.sku ORDER BY revenue DESC LIMIT 100`;
    return { products };
  },

  async getCustomerReport(auth: AuthContext) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const customers = await prisma.$queryRaw<any[]>`
      SELECT c."firstName", c."lastName", c."customerType", COUNT(s.id)::int as "purchaseCount",
        COALESCE(SUM(s."totalAmount"), 0) as revenue, MAX(s."createdAt") as "lastPurchase"
      FROM "Customer" c LEFT JOIN "Sale" s ON s."customerId" = c.id AND s."status" = 'COMPLETED'
      WHERE c."organizationId" = ${organizationId}
        ${branchIds && branchIds.length > 0 ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "Sale" scoped_sale
          WHERE scoped_sale."customerId" = c.id AND scoped_sale."branchId" IN (${Prisma.join(branchIds)})
        )` : Prisma.empty}
      GROUP BY c.id, c."firstName", c."lastName", c."customerType" ORDER BY revenue DESC LIMIT 100`;
    return { customers };
  },

  async getSupplierReport(auth: AuthContext) {
    const { organizationId } = scopeFilter(auth);
    const suppliers = await prisma.$queryRaw<any[]>`
      SELECT s.name as "supplierName", COUNT(po.id)::int as "poCount",
        COALESCE(SUM(po."totalAmount"), 0) as "purchaseValue"
      FROM "Supplier" s LEFT JOIN "PurchaseOrder" po ON po."supplierId" = s.id
      WHERE s."organizationId" = ${organizationId}
      GROUP BY s.id, s.name ORDER BY "purchaseValue" DESC LIMIT 100`;
    return { suppliers };
  },

  async getPaymentReport(auth: AuthContext, startDate: Date, endDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const byMethod = await prisma.$queryRaw<any[]>`
      SELECT "paymentMethod", status, COUNT(id)::int as count, COALESCE(SUM(amount), 0) as total
      FROM "Payment" WHERE "organizationId" = ${organizationId} ${branchSQL(branchIds)}
        AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
      GROUP BY "paymentMethod", status ORDER BY total DESC`;
    return { byMethod };
  },

  async getRefundReport(auth: AuthContext, startDate: Date, endDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const refunds = await prisma.$queryRaw<any[]>`
      SELECT method, COUNT(id)::int as count, COALESCE(SUM(amount), 0) as total
      FROM "Refund" WHERE "organizationId" = ${organizationId} ${branchSQL(branchIds)}
        AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
      GROUP BY method ORDER BY total DESC`;
    return { refunds };
  },

  async getExpenseReport(auth: AuthContext, startDate: Date, endDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const byCategory = await prisma.$queryRaw<any[]>`
      SELECT ec.name as "categoryName", e.status, COUNT(e.id)::int as count, COALESCE(SUM(e.amount), 0) as total
      FROM "Expense" e JOIN "ExpenseCategory" ec ON e."categoryId" = ec.id
      WHERE e."organizationId" = ${organizationId} ${branchIds && branchIds.length > 0 ? Prisma.sql`AND e."branchId" IN (${Prisma.join(branchIds)})` : Prisma.empty}
        AND e."createdAt" >= ${startDate} AND e."createdAt" <= ${endDate}
      GROUP BY ec.name, e.status ORDER BY total DESC`;
    return { byCategory };
  },

  async getReconciliationReport(auth: AuthContext, startDate: Date, endDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const records = await prisma.dailyBranchReconciliation.findMany({
      where: {
        organizationId,
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        reconciliationDate: { gte: startDate, lte: endDate }
      },
      include: { branch: true },
      orderBy: { reconciliationDate: "desc" }
    });
    return { records };
  },

  async getInventoryValuation(auth: AuthContext) {
    const { organizationId, branchIds } = scopeFilter(auth);
    const valuation = await prisma.$queryRaw<any[]>`
      SELECT b.id as "branchId", b.name as "branchName", COUNT(ib.id)::int as "totalItems",
        COALESCE(SUM(ib."quantityOnHand"), 0) as "totalQuantity",
        COALESCE(SUM(ib."quantityOnHand" * ib."averageUnitCost"), 0) as "estimatedValuation"
      FROM "InventoryBalance" ib JOIN "Branch" b ON ib."branchId" = b.id
      WHERE ib."organizationId" = ${organizationId} ${branchIds && branchIds.length > 0 ? Prisma.sql`AND ib."branchId" IN (${Prisma.join(branchIds)})` : Prisma.empty}
      GROUP BY b.id, b.name`;
    return valuation;
  },

  async getStockAlerts(auth: AuthContext) {
    const scope = buildUserScope(auth);
    const alerts = await prisma.inventoryBalance.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
        quantityOnHand: { lte: 15 }
      },
      include: { branch: true, productVariant: { include: { product: true } } },
      orderBy: { quantityOnHand: "asc" }
    });
    return alerts.map(a => ({
      branchName: a.branch.name,
      variantName: `${a.productVariant.product.name} - ${a.productVariant.volumeValue ?? ""} ${a.productVariant.volumeUnit ?? ""}`,
      sku: a.productVariant.sku, quantityOnHand: Number(a.quantityOnHand),
      status: Number(a.quantityOnHand) === 0 ? "OUT_OF_STOCK" : "LOW_STOCK"
    }));
  },

  async getDashboardCashSummary(auth: AuthContext, branchId: string | undefined, targetDate: Date) {
    const { organizationId, branchIds } = scopeFilter(auth);

    // Determine the branchId we are querying
    let targetBranchId = branchId;
    if (targetBranchId) {
      assertBranchAccess(auth, targetBranchId);
    } else {
      if (branchIds && branchIds.length > 0) {
        targetBranchId = branchIds[0];
      }
    }

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Find active or latest shift today for opening float
    const latestShift = await prisma.shift.findFirst({
      where: {
        organizationId,
        ...(targetBranchId ? { branchId: targetBranchId } : {}),
        openedAt: { gte: startOfDay, lte: endOfDay }
      },
      orderBy: { openedAt: "asc" }
    });

    const openingFloat = latestShift ? Number(latestShift.openingCash) : 0;

    // Cash Sales today
    const cashSalesAgg = await prisma.payment.aggregate({
      where: {
        organizationId,
        ...(targetBranchId ? { branchId: targetBranchId } : {}),
        paymentMethod: "CASH",
        status: "COMPLETED",
        createdAt: { gte: startOfDay, lte: endOfDay }
      },
      _sum: { amount: true }
    });
    const cashSales = cashSalesAgg._sum.amount ? Number(cashSalesAgg._sum.amount) : 0.00;

    // Cash Refunds today (from shift cash movements of type CASH_REFUND)
    const cashMovements = await prisma.shiftCashMovement.findMany({
      where: {
        shift: {
          organizationId,
          ...(targetBranchId ? { branchId: targetBranchId } : {}),
          openedAt: { gte: startOfDay, lte: endOfDay }
        }
      }
    });

    const cashRefunds = cashMovements
      .filter(m => m.movementType === "CASH_REFUND")
      .reduce((sum, m) => sum + Number(m.amount), 0.00);

    // Cash Expenses today
    const expensesAgg = await prisma.expense.aggregate({
      where: {
        organizationId,
        ...(targetBranchId ? { branchId: targetBranchId } : {}),
        status: { in: ["APPROVED", "PAID"] },
        createdAt: { gte: startOfDay, lte: endOfDay }
      },
      _sum: { amount: true }
    });
    const cashExpenses = expensesAgg._sum.amount ? Number(expensesAgg._sum.amount) : 0.00;

    // Cash In / Cash Out movements today
    const cashIn = cashMovements
      .filter(m => m.movementType === "CASH_IN")
      .reduce((sum, m) => sum + Number(m.amount), 0.00);

    const cashOut = cashMovements
      .filter(m => m.movementType === "CASH_OUT")
      .reduce((sum, m) => sum + Number(m.amount), 0.00);

    const expectedCash = openingFloat + cashSales - cashRefunds - cashExpenses + cashIn - cashOut;

    // If shift is closed, show declared & variance
    const activeOrLatestShift = await prisma.shift.findFirst({
      where: {
        organizationId,
        ...(targetBranchId ? { branchId: targetBranchId } : {}),
        openedAt: { gte: startOfDay, lte: endOfDay }
      },
      orderBy: { openedAt: "desc" }
    });

    const declaredCash = activeOrLatestShift && activeOrLatestShift.status === "CLOSED"
      ? Number(activeOrLatestShift.declaredCash)
      : null;

    const variance = activeOrLatestShift && activeOrLatestShift.status === "CLOSED"
      ? Number(activeOrLatestShift.cashVariance)
      : null;

    return {
      openingFloat,
      cashSales,
      cashRefunds,
      cashExpenses,
      cashIn,
      cashOut,
      expectedCash,
      declaredCash,
      variance
    };
  },
  convertToCSV(data: any[]): string {
    if (data.length === 0) return "";
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(",")];
    for (const row of data) {
      const values = headers.map(h => { const v = row[h]; return `"${String(v ?? "").replace(/"/g, '\\"')}"`; });
      csvRows.push(values.join(","));
    }
    return csvRows.join("\n");
  }
};
