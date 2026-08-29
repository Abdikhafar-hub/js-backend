const PRIVATE_RESPONSE_KEYS = new Set([
  "passwordHash",
  "twoFactorSecretEncrypted",
  "tokenVersion",
  "tokenHash",
  "refreshToken",
  "refreshTokenHash",
  "resetToken",
  "resetTokenHash",
  "emailVerificationToken",
  "emailVerificationTokenHash",
  "recoveryCode",
  "recoveryCodes",
  "recoveryData",
  "failedLoginAttempts",
  "lockedUntil",
  "lastLoginIp",
  "privateSecurityMetadata",
  "consumerKey",
  "consumerSecret",
  "passkey"
]);

export const sanitizePrivateResponseFields = <T>(value: T, preserveKeys: readonly string[] = []): T => {
  const preserved = new Set(preserveKeys);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePrivateResponseFields(item, preserveKeys)) as T;
  }

  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => preserved.has(key) || !PRIVATE_RESPONSE_KEYS.has(key))
      .map(([key, nested]) => [key, sanitizePrivateResponseFields(nested, preserveKeys)])
  ) as T;
};

export const serializeUser = <T>(user: T): T => sanitizePrivateResponseFields(user);
