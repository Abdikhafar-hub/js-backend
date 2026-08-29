import crypto from "crypto";
import { env } from "../config/env.js";

// Prefix to distinguish encrypted values from legacy plaintext values
const ENCRYPTION_PREFIX = "enc::";
const ALGORITHM = "aes-256-cbc";

// Derive a 32-byte key from the environment ENCRYPTION_KEY
const getEncryptionKey = (): Buffer => {
  return crypto.createHash("sha256").update(env.ENCRYPTION_KEY).digest();
};

/**
 * Encrypts a plaintext string.
 */
export function encrypt(text: string): string {
  if (!text) return text;
  
  const iv = crypto.randomBytes(16);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  return `${ENCRYPTION_PREFIX}${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a cipher text. If the text is not encrypted (does not start with the prefix)
 * or if decryption fails, it returns the input text as-is.
 */
export function decrypt(cipherText: string): string {
  if (!cipherText || !cipherText.startsWith(ENCRYPTION_PREFIX)) {
    return cipherText;
  }

  try {
    const rawPayload = cipherText.substring(ENCRYPTION_PREFIX.length);
    const parts = rawPayload.split(":");
    if (parts.length !== 2) {
      return cipherText;
    }

    const [ivHex, encryptedHex] = parts;
    if (!ivHex || !encryptedHex) {
      return cipherText;
    }
    const iv = Buffer.from(ivHex, "hex");
    const encryptedText = Buffer.from(encryptedHex, "hex");
    const key = getEncryptionKey();
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("Failed to decrypt value. Returning plaintext fallback:", err);
    return cipherText;
  }
}
