import { describe, expect, it } from "vitest";

import { sanitizePrivateResponseFields, serializeUser } from "../src/lib/safe-response.js";

describe("private response serialization", () => {
  const privateKeys = [
    "passwordHash",
    "twoFactorSecretEncrypted",
    "tokenVersion",
    "tokenHash",
    "failedLoginAttempts",
    "lockedUntil",
    "lastLoginIp"
  ];

  it("removes authentication and lockout internals from users", () => {
    const serialized = serializeUser({
      id: "user-1",
      firstName: "Safe",
      passwordHash: "hash",
      twoFactorSecretEncrypted: "secret",
      tokenVersion: 7,
      failedLoginAttempts: 2,
      lockedUntil: new Date(),
      lastLoginIp: "127.0.0.1"
    }) as Record<string, unknown>;

    expect(serialized).toMatchObject({ id: "user-1", firstName: "Safe" });
    for (const key of privateKeys) expect(serialized).not.toHaveProperty(key);
  });

  it("recursively strips private fields from nested relations and audit snapshots", () => {
    const serialized = sanitizePrivateResponseFields({
      createdBy: { id: "user-1", passwordHash: "hash" },
      afterData: { user: { tokenHash: "token", tokenVersion: 1 } }
    });

    expect(serialized).toEqual({
      createdBy: { id: "user-1" },
      afterData: { user: {} }
    });
  });
});
