import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { shapeOperationalResponse } from "../src/lib/response-scope.js";
import type { AuthContext } from "../src/types/auth.js";

const auth = (role: UserRole): AuthContext => ({
  userId: "user-1",
  organizationId: "org-1",
  role,
  branchIds: ["branch-1"],
  sessionId: "session-1",
  tokenVersion: 1
});

const record = {
  defaultCost: 100,
  averageUnitCost: 105,
  landedUnitCost: 110,
  grossProfit: 30,
  totalValuationCost: 500,
  customer: {
    customerNumber: "CUS-1",
    creditLimit: 10_000,
    currentOutstandingBalance: 500,
    firstName: "Amina"
  }
};

describe("shapeOperationalResponse", () => {
  it("keeps full financial data for General Manager", () => {
    expect(shapeOperationalResponse(auth(UserRole.GENERAL_MANAGER), record)).toEqual(record);
  });

  it("keeps explicitly allowed branch valuation but strips supplier cost for Branch Manager", () => {
    const shaped = shapeOperationalResponse(auth(UserRole.BRANCH_MANAGER), record) as Record<string, any>;
    expect(shaped.defaultCost).toBeUndefined();
    expect(shaped.landedUnitCost).toBeUndefined();
    expect(shaped.averageUnitCost).toBe(105);
    expect(shaped.grossProfit).toBe(30);
    expect(shaped.customer.creditLimit).toBe(10_000);
  });

  it("strips all cost and customer-credit fields for Sales Attendant", () => {
    const shaped = shapeOperationalResponse(auth(UserRole.SALES_ATTENDANT), record) as Record<string, any>;
    expect(shaped.defaultCost).toBeUndefined();
    expect(shaped.averageUnitCost).toBeUndefined();
    expect(shaped.grossProfit).toBeUndefined();
    expect(shaped.totalValuationCost).toBeUndefined();
    expect(shaped.customer.creditLimit).toBeUndefined();
    expect(shaped.customer.currentOutstandingBalance).toBeUndefined();
    expect(shaped.customer.firstName).toBe("Amina");
  });
});
