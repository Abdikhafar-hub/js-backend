import { describe, expect, it } from "vitest";
import { loginSchema, forgotPasswordSchema } from "../src/modules/auth/auth.schemas.js";

describe("Auth Module Validation Schemas", () => {
  it("validates a correct login payload without organizationId", () => {
    const payload = {
      body: {
        email: "gm@pulseperfumes.test",
        password: "password12345"
      }
    };
    const parsed = loginSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("fails login validation if email is invalid", () => {
    const payload = {
      body: {
        email: "invalid-email",
        password: "password12345"
      }
    };
    const parsed = loginSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("fails login validation if password is too short", () => {
    const payload = {
      body: {
        email: "gm@pulseperfumes.test",
        password: "short"
      }
    };
    const parsed = loginSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("validates a correct forgot-password payload without organizationId", () => {
    const payload = {
      body: {
        email: "gm@pulseperfumes.test"
      }
    };
    const parsed = forgotPasswordSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("fails forgot-password validation if email is missing", () => {
    const payload = {
      body: {}
    };
    const parsed = forgotPasswordSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});
