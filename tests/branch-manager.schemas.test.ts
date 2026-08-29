import { describe, expect, it } from "vitest";

import {
  assignBranchManagerSchema,
  createBranchSchema
} from "../src/modules/branches/branch.schemas.js";

describe("branch manager workflow schemas", () => {
  it("accepts branch creation without a manager", () => {
    const parsed = createBranchSchema.safeParse({
      body: {
        code: "NBO01",
        name: "Nairobi CBD",
        branchType: "RETAIL_STORE"
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts branch creation with a new manager payload", () => {
    const parsed = createBranchSchema.safeParse({
      body: {
        code: "MSA01",
        name: "Mombasa",
        branchType: "RETAIL_STORE",
        manager: {
          mode: "CREATE_NEW",
          firstName: "Asha",
          lastName: "Njeri",
          phone: "0712345678",
          email: "asha@example.com",
          password: "TempPass123!"
        }
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects incomplete manager creation payloads", () => {
    const parsed = createBranchSchema.safeParse({
      body: {
        code: "KSM01",
        name: "Kisumu",
        branchType: "RETAIL_STORE",
        manager: {
          mode: "CREATE_NEW",
          firstName: "Asha",
          lastName: "",
          phone: "0712345678",
          email: "asha@example.com",
          password: "short"
        }
      }
    });

    expect(parsed.success).toBe(false);
  });

  it("requires a user id when assigning an existing manager", () => {
    const parsed = assignBranchManagerSchema.safeParse({
      params: {
        branchId: "ck1234567890123456789012"
      },
      body: {
        manager: {
          mode: "ASSIGN_EXISTING"
        }
      }
    });

    expect(parsed.success).toBe(false);
  });
});
