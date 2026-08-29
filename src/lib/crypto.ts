import { createHash, randomBytes } from "node:crypto";

export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

export const generateSecureToken = (bytes = 32) => randomBytes(bytes).toString("hex");
