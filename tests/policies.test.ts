import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { hasPermission } from "../src/policies/role-permissions.js";
import { PERMISSIONS } from "../src/policies/permissions.js";

describe("role permissions", () => {
  it("allows general managers to update prices", () => {
    expect(hasPermission(UserRole.GENERAL_MANAGER, PERMISSIONS.priceUpdate)).toBe(true);
  });

  it("prevents attendants from updating prices", () => {
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.priceUpdate)).toBe(false);
  });

  it("allows branch managers to perform inventory adjustments for stock counts", () => {
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.inventoryAdjust)).toBe(true);
  });

  it("denies branch managers organization administration APIs", () => {
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.supplierRead)).toBe(false);
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.procurementApprove)).toBe(false);
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.auditRead)).toBe(false);
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.organizationUpdate)).toBe(false);
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.mpesaConfigManage)).toBe(false);
  });

  it("allows branch supplier lookup without supplier administration", () => {
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.supplierLookup)).toBe(true);
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.supplierWrite)).toBe(false);
  });

  it("allows branch managers to review stock issues", () => {
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.stockIssueReview)).toBe(true);
  });

  it("allows attendants to report stock issues but not review them", () => {
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.stockIssueReport)).toBe(true);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.stockIssueReview)).toBe(false);
  });

  it("denies attendants reports, valuation, transfers, and reconciliation", () => {
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.reportRead)).toBe(false);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.inventoryValuation)).toBe(false);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.transferRequest)).toBe(false);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.reconciliationRead)).toBe(false);
  });

  it("keeps POS and cash-drawer operation out of the general-manager role", () => {
    expect(hasPermission(UserRole.GENERAL_MANAGER, PERMISSIONS.posOperate)).toBe(false);
    expect(hasPermission(UserRole.GENERAL_MANAGER, PERMISSIONS.shiftOperate)).toBe(false);
    expect(hasPermission(UserRole.GENERAL_MANAGER, PERMISSIONS.saleReadAll)).toBe(true);
  });

  it("allows branch cashiers to operate POS", () => {
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.posOperate)).toBe(true);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.posOperate)).toBe(true);
  });

  it("splits customer financial authority by role", () => {
    expect(hasPermission(UserRole.GENERAL_MANAGER, PERMISSIONS.customerCreditManage)).toBe(true);
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.customerFinancialRead)).toBe(true);
    expect(hasPermission(UserRole.BRANCH_MANAGER, PERMISSIONS.customerCreditManage)).toBe(false);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.customerRead)).toBe(true);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.customerWrite)).toBe(true);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.customerFinancialRead)).toBe(false);
    expect(hasPermission(UserRole.SALES_ATTENDANT, PERMISSIONS.customerCreditManage)).toBe(false);
  });
});
