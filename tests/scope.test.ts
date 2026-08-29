import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildUserScope } from "../src/lib/scope.js";

describe("buildUserScope", () => {
  it("returns organization-only scope for general managers", () => {
    expect(
      buildUserScope({
        userId: "u1",
        organizationId: "org1",
        role: UserRole.GENERAL_MANAGER,
        sessionId: "s1",
        tokenVersion: 1,
        branchIds: []
      })
    ).toEqual({
      organizationId: "org1"
    });
  });

  it("returns assigned branches for branch-scoped users", () => {
    expect(
      buildUserScope({
        userId: "u1",
        organizationId: "org1",
        role: UserRole.BRANCH_MANAGER,
        sessionId: "s1",
        tokenVersion: 1,
        branchIds: ["b1"]
      })
    ).toEqual({
      organizationId: "org1",
      branchIds: ["b1"]
    });
  });
});
