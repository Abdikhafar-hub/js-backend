import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildCustomerAccessWhere, shapeCustomerForRole } from "../src/modules/customers/customers.service.js";
import type { AuthContext } from "../src/types/auth.js";

const auth = (role: UserRole, branchIds: string[] = ["branch-1"]): AuthContext => ({
  userId: "user-1", organizationId: "org-1", role, sessionId: "session-1", tokenVersion: 1, branchIds
});

const customer = {
  id: "customer-1", customerNumber: "CUST-1", firstName: "Aura", phone: "0700000000",
  customerType: "RETAIL", loyaltyPointsBalance: 50, preferredBranchId: "branch-1",
  currentOutstandingBalance: 1_500, creditAllowed: true, creditLimit: 10_000,
  paymentTermsDays: 30, taxNumber: "PIN-SECRET", notes: "confidential", status: "ACTIVE"
};

describe("customer API scope and response shaping", () => {
  it("uses organization scope for the general manager", () => {
    expect(buildCustomerAccessWhere(auth(UserRole.GENERAL_MANAGER, []))).toEqual({ organizationId: "org-1" });
    expect(shapeCustomerForRole(auth(UserRole.GENERAL_MANAGER), customer)).toEqual(customer);
  });

  it("adds assigned-branch relevance for branch managers", () => {
    expect(buildCustomerAccessWhere(auth(UserRole.BRANCH_MANAGER))).toEqual(expect.objectContaining({
      organizationId: "org-1",
      AND: [expect.objectContaining({ OR: expect.any(Array) })]
    }));
  });

  it("rejects an unassigned customer branch filter", () => {
    expect(() => buildCustomerAccessWhere(auth(UserRole.BRANCH_MANAGER), { branchId: "branch-2" }))
      .toThrowError(expect.objectContaining({ statusCode: 403 }));
  });

  it("redacts global credit controls and notes from branch managers", () => {
    const shaped = shapeCustomerForRole(auth(UserRole.BRANCH_MANAGER), customer);
    expect(shaped).toEqual(expect.objectContaining({ id: "customer-1" }));
    expect(shaped).not.toHaveProperty("currentOutstandingBalance");
    expect(shaped).not.toHaveProperty("creditLimit");
    expect(shaped).not.toHaveProperty("creditAllowed");
    expect(shaped).not.toHaveProperty("paymentTermsDays");
    expect(shaped).not.toHaveProperty("notes");
  });

  it("exposes only a computed assigned-branch outstanding balance to branch managers", () => {
    const shaped = shapeCustomerForRole(auth(UserRole.BRANCH_MANAGER), {
      ...customer, branchScopedOutstandingBalance: 400
    });
    expect(shaped).toHaveProperty("currentOutstandingBalance", 400);
    expect(shaped).not.toHaveProperty("branchScopedOutstandingBalance");
  });

  it("returns only sale-safe customer fields to attendants", () => {
    const shaped = shapeCustomerForRole(auth(UserRole.SALES_ATTENDANT), customer);
    expect(shaped).toEqual(expect.objectContaining({ id: "customer-1", phone: "0700000000", loyaltyPointsBalance: 50 }));
    for (const field of ["currentOutstandingBalance", "creditAllowed", "creditLimit", "paymentTermsDays", "taxNumber", "notes"]) {
      expect(shaped).not.toHaveProperty(field);
    }
  });
});
