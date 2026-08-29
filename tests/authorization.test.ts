import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { assertBranchAccess } from "../src/lib/scope.js";
import { shapeOperationalResponse } from "../src/lib/response-scope.js";
import { authorizePermission } from "../src/middleware/authorize.middleware.js";
import { PERMISSIONS } from "../src/policies/permissions.js";
import type { AuthContext } from "../src/types/auth.js";

const auth = (role: UserRole): AuthContext => ({ userId: "user-1", organizationId: "org-1", role, sessionId: "session-1", tokenVersion: 1, branchIds: ["branch-1"] });

describe("direct API authorization", () => {
  it("returns 403 permission failures for restricted branch-manager APIs", () => {
    for (const permission of [PERMISSIONS.supplierRead, PERMISSIONS.procurementApprove, PERMISSIONS.auditRead, PERMISSIONS.mpesaConfigManage]) {
      expect(() => authorizePermission(permission)({ auth: auth(UserRole.BRANCH_MANAGER) } as never)).toThrowError(expect.objectContaining({ statusCode: 403 }));
    }
  });

  it("returns 403 permission failures for sensitive attendant APIs", () => {
    for (const permission of [
      PERMISSIONS.inventoryValuation, PERMISSIONS.reportRead, PERMISSIONS.reconciliationRead,
      PERMISSIONS.customerFinancialRead, PERMISSIONS.customerCreditManage
    ]) {
      expect(() => authorizePermission(permission)({ auth: auth(UserRole.SALES_ATTENDANT) } as never)).toThrowError(expect.objectContaining({ statusCode: 403 }));
    }
  });

  it("returns 403 for general-manager POS and cash-drawer APIs", () => {
    for (const permission of [PERMISSIONS.posOperate, PERMISSIONS.shiftOperate]) {
      expect(() => authorizePermission(permission)({ auth: auth(UserRole.GENERAL_MANAGER) } as never)).toThrowError(expect.objectContaining({ statusCode: 403 }));
    }
  });

  it("returns 403 for branch-manager customer credit administration", () => {
    expect(() => authorizePermission(PERMISSIONS.customerCreditManage)({ auth: auth(UserRole.BRANCH_MANAGER) } as never)).toThrowError(expect.objectContaining({ statusCode: 403 }));
  });

  it("rejects an arbitrary branch id", () => {
    expect(() => assertBranchAccess(auth(UserRole.BRANCH_MANAGER), "branch-2")).toThrowError(expect.objectContaining({ statusCode: 403 }));
  });

  it("removes cost and profit fields from attendant responses", () => {
    const shaped = shapeOperationalResponse(auth(UserRole.SALES_ATTENDANT), {
      sku: "SKU-1", unitCost: 500, landedUnitCost: 550, grossProfit: 300,
      nested: { averageUnitCost: 520, quantityOnHand: 4 }
    });
    expect(shaped).toEqual({ sku: "SKU-1", nested: { quantityOnHand: 4 } });
  });

  it("redacts embedded customer finance fields from attendant operational APIs", () => {
    const shaped = shapeOperationalResponse(auth(UserRole.SALES_ATTENDANT), {
      saleNumber: "SALE-1",
      customer: {
        id: "customer-1", customerNumber: "CUST-1", customerType: "RETAIL",
        firstName: "Aura", phone: "0700000000", loyaltyPointsBalance: 20,
        currentOutstandingBalance: 1_500, creditAllowed: true, creditLimit: 10_000,
        paymentTermsDays: 30, taxNumber: "PIN-SECRET", notes: "confidential"
      }
    });
    expect(shaped).toEqual({
      saleNumber: "SALE-1",
      customer: {
        id: "customer-1", customerNumber: "CUST-1", customerType: "RETAIL",
        firstName: "Aura", phone: "0700000000", loyaltyPointsBalance: 20
      }
    });
  });

  it("keeps embedded customer finance fields in branch-manager responses without hiding costs", () => {
    const shaped = shapeOperationalResponse(auth(UserRole.BRANCH_MANAGER), {
      unitCost: 500,
      customer: {
        id: "customer-1",
        customerNumber: "CUST-1",
        firstName: "Aura",
        currentOutstandingBalance: 1_500,
        creditLimit: 10_000,
        notes: "confidential"
      }
    });
    expect(shaped).toEqual({
      unitCost: 500,
      customer: {
        id: "customer-1",
        customerNumber: "CUST-1",
        firstName: "Aura",
        currentOutstandingBalance: 1_500,
        creditLimit: 10_000,
        notes: "confidential"
      }
    });
  });
});
