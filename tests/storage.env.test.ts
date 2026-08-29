import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("storage environment validation", () => {
  it("fails fast when Cloudinary is selected without credentials", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "";
    process.env.CLOUDINARY_API_KEY = "";
    process.env.CLOUDINARY_API_SECRET = "";
    process.env.STORAGE_PROVIDER = "cloudinary";

    await expect(import("../src/config/env.js")).rejects.toThrow();
  });

  it("selects the configured storage provider", async () => {
    process.env.STORAGE_PROVIDER = "cloudinary";
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "key";
    process.env.CLOUDINARY_API_SECRET = "secret";

    const { getStorageProvider } = await import("../src/services/storage.service.js");
    expect(getStorageProvider().name).toBe("cloudinary");
  });
});
