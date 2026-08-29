import fs from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cloudinaryMock = vi.hoisted(() => ({
  config: vi.fn(),
  uploadStream: vi.fn(),
  destroy: vi.fn(),
  resource: vi.fn()
}));

vi.mock("cloudinary", () => ({
  v2: {
    config: cloudinaryMock.config,
    uploader: {
      upload_stream: cloudinaryMock.uploadStream,
      destroy: cloudinaryMock.destroy
    },
    api: {
      resource: cloudinaryMock.resource
    }
  }
}));

describe("storage providers", () => {
  const uploadsDir = path.join(process.cwd(), "uploads");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (fs.existsSync(uploadsDir)) {
      const files = await fs.promises.readdir(uploadsDir);
      await Promise.all(files.map((file) => fs.promises.unlink(path.join(uploadsDir, file))));
    }
  });

  it("keeps the local provider contract for upload and delete", async () => {
    const { LocalStorageProvider } = await import("../src/services/storage/local-storage.provider.js");
    const provider = new LocalStorageProvider();
    const stored = await provider.uploadFile({
      file: {
        buffer: Buffer.from("image-bytes"),
        originalname: "sample.jpg",
        mimetype: "image/jpeg",
        size: 11
      },
      category: "product-image",
      folderSegments: ["js-system", "storefront", "products", "product-1"]
    });

    expect(stored.storageProvider).toBe("local");
    expect(stored.storageKey).toBeTruthy();
    expect(fs.existsSync(path.join(uploadsDir, stored.storageKey))).toBe(true);

    await provider.deleteFile(stored.storageKey);
    expect(fs.existsSync(path.join(uploadsDir, stored.storageKey))).toBe(false);
  });

  it("uploads to Cloudinary and returns normalized metadata", async () => {
    cloudinaryMock.uploadStream.mockImplementation((options, callback) => ({
      on: vi.fn().mockReturnThis(),
      end: () =>
        callback(null, {
          secure_url: "https://res.cloudinary.com/demo/image/upload/v1/js-system/image.jpg",
          public_id: `${options.folder}/${options.public_id}`,
          resource_type: "image",
          format: "jpg",
          bytes: 2048,
          width: 1200,
          height: 900
        })
    }));

    const { CloudinaryStorageProvider } = await import("../src/services/storage/cloudinary-storage.provider.js");
    const provider = new CloudinaryStorageProvider();
    const stored = await provider.uploadFile({
      file: {
        buffer: Buffer.from("image"),
        originalname: "sample.jpg",
        mimetype: "image/jpeg",
        size: 5
      },
      category: "product-image",
      folderSegments: ["js-system", "storefront", "products", "product-1"],
      publicId: "product-media-1"
    });

    expect(stored).toMatchObject({
      storageProvider: "cloudinary",
      resourceType: "image",
      format: "jpg",
      bytes: 2048,
      width: 1200,
      height: 900
    });
    expect(stored.storageKey).toContain("js-system/storefront/products/product-1/product-media-1");
  });

  it("rejects invalid Cloudinary upload MIME types", async () => {
    const { CloudinaryStorageProvider } = await import("../src/services/storage/cloudinary-storage.provider.js");
    const provider = new CloudinaryStorageProvider();

    await expect(
      provider.uploadFile({
        file: {
          buffer: Buffer.from("<svg></svg>"),
          originalname: "sample.svg",
          mimetype: "image/svg+xml",
          size: 11
        },
        category: "product-image",
        folderSegments: ["js-system", "storefront", "products", "product-1"]
      })
    ).rejects.toThrow("Unsupported file type");
  });

  it("uses the requested Cloudinary resource type when deleting", async () => {
    cloudinaryMock.destroy.mockResolvedValue({ result: "ok" });

    const { CloudinaryStorageProvider } = await import("../src/services/storage/cloudinary-storage.provider.js");
    const provider = new CloudinaryStorageProvider();
    await provider.deleteFile("js-system/documents/invoices/file-1", { resourceType: "raw" });

    expect(cloudinaryMock.destroy).toHaveBeenCalledWith("js-system/documents/invoices/file-1", {
      resource_type: "raw",
      invalidate: true
    });
  });

  it("deletes legacy local uploads through the shared storage service", async () => {
    const localFilename = "legacy-delete-test.jpg";
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    await fs.promises.writeFile(path.join(uploadsDir, localFilename), Buffer.from("legacy"));

    const { storageService } = await import("../src/services/storage.service.js");
    await storageService.deleteStoredFile({
      url: `/uploads/${localFilename}`,
      storageProvider: null,
      storageKey: null
    });

    expect(fs.existsSync(path.join(uploadsDir, localFilename))).toBe(false);
  });
});
