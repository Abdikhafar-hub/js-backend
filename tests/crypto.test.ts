import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/utils/crypto.js";

describe("Cryptographic Helpers", () => {
  it("should encrypt and decrypt a string successfully", () => {
    const raw = "Safaricom_Mpesa_Secret_Key_12345!";
    const encrypted = encrypt(raw);
    
    expect(encrypted).not.toBe(raw);
    expect(encrypted.startsWith("enc::")).toBe(true);
    
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(raw);
  });

  it("should return the original string if decrypting legacy plaintext (not starting with enc::)", () => {
    const legacyPlaintext = "Legacy_Plaintext_Secret";
    const decrypted = decrypt(legacyPlaintext);
    
    expect(decrypted).toBe(legacyPlaintext);
  });

  it("should fallback to original string if decryption fails due to invalid encrypted payload", () => {
    const invalidEncrypted = "enc::invalid_iv:invalid_data";
    const decrypted = decrypt(invalidEncrypted);
    
    expect(decrypted).toBe(invalidEncrypted);
  });
});
