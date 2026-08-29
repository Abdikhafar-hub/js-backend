import { UserRole } from "@prisma/client";

import type { AuthContext } from "../types/auth.js";

const SALES_ATTENDANT_COST_KEYS = new Set([
  "defaultCost", "averageCost", "landedCost", "unitCost", "landedUnitCost",
  "averageUnitCost", "totalCOGS", "costOfGoodsSold", "cogs", "lineCost",
  "grossProfit", "grossProfitAmount", "grossMargin", "margin", "marginPercent",
  "totalValuationCost", "inventoryValuation", "supplierUnitCost", "batchUnitCost",
  "rawCallbackPayload", "rawPayload"
]);

// Branch managers may see branch valuation and branch profitability because their role
// explicitly carries inventory.valuation and report.read. Supplier acquisition prices
// and organization-level catalogue defaults remain General Manager-only.
const BRANCH_MANAGER_COST_KEYS = new Set([
  "defaultCost", "landedCost", "landedUnitCost", "supplierUnitCost",
  "batchUnitCost", "rawCallbackPayload", "rawPayload"
]);

const CONFIDENTIAL_CUSTOMER_KEYS = new Set([
  "creditAllowed", "creditLimit", "currentOutstandingBalance", "paymentTermsDays",
  "taxNumber", "notes", "notesHistory"
]);

const redact = (value: unknown, costKeys: Set<string>, redactCustomerFinance: boolean): unknown => {
  if (Array.isArray(value)) return value.map((item) => redact(item, costKeys, redactCustomerFinance));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const record = value as Record<string, unknown>;
  const isCustomer = "customerNumber" in record || ("customerType" in record && "loyaltyPointsBalance" in record);
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !costKeys.has(key) && !(redactCustomerFinance && isCustomer && CONFIDENTIAL_CUSTOMER_KEYS.has(key)))
      .map(([key, nested]) => [key, redact(nested, costKeys, redactCustomerFinance)])
  );
};

export const shapeOperationalResponse = <T>(auth: AuthContext, value: T): T => {
  if (auth.role === UserRole.GENERAL_MANAGER) return value;

  return redact(
    value,
    auth.role === UserRole.SALES_ATTENDANT ? SALES_ATTENDANT_COST_KEYS : BRANCH_MANAGER_COST_KEYS,
    auth.role === UserRole.SALES_ATTENDANT
  ) as T;
};
