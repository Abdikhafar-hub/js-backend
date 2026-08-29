import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}));

const prismaMock = vi.hoisted(() => ({
  product: {
    findFirst: vi.fn()
  },
  productMedia: {
    findFirst: vi.fn(),
    delete: vi.fn()
  },
  $transaction: vi.fn()
}));

const storageMock = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  deleteStoredFile: vi.fn(),
  provider: {
    name: "cloudinary"
  }
}));

vi.mock("../src/config/logger.js", () => ({
  logger: loggerMock
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: prismaMock
}));

vi.mock("../src/services/storage.service.js", () => ({
  buildProductMediaFolderSegments: (productId: string) => ["js-system", "storefront", "products", productId],
  storageService: storageMock
}));

describe("storefrontMediaService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.product.findFirst.mockResolvedValue({ id: "product-1" });
  });

  it("compensates by deleting a newly uploaded asset when the database write fails", async () => {
    storageMock.uploadFile.mockResolvedValue({
      url: "https://res.cloudinary.com/demo/image/upload/v1/new.jpg",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/new.jpg",
      storageKey: "js-system/storefront/products/product-1/new",
      publicId: "js-system/storefront/products/product-1/new",
      resourceType: "image",
      storageProvider: "cloudinary"
    });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        productMedia: {
          updateMany: vi.fn(),
          create: vi.fn().mockRejectedValue(new Error("db create failed"))
        }
      })
    );

    const { storefrontMediaService } = await import("../src/modules/storefront/storefront-media.service.js");

    await expect(
      storefrontMediaService.uploadProductMedia({
        organizationId: "org-1",
        userId: "user-1",
        productId: "product-1",
        file: {
          buffer: Buffer.from("image"),
          originalname: "sample.jpg",
          mimetype: "image/jpeg",
          size: 5
        },
        isPrimary: true
      })
    ).rejects.toThrow("db create failed");

    expect(storageMock.deleteStoredFile).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: "js-system/storefront/products/product-1/new",
        storageProvider: "cloudinary"
      })
    );
  });

  it("replaces an existing media asset and deletes the previous stored file after a successful update", async () => {
    prismaMock.productMedia.findFirst.mockResolvedValue({
      id: "media-1",
      productId: "product-1",
      productVariantId: null,
      altText: "old",
      title: null,
      displayOrder: 0,
      isPrimary: true,
      isPublished: true,
      storageProvider: "local",
      storageKey: "legacy.jpg",
      resourceType: "image",
      url: "/uploads/legacy.jpg"
    });
    storageMock.uploadFile.mockResolvedValue({
      url: "https://res.cloudinary.com/demo/image/upload/v1/new.jpg",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/new.jpg",
      storageKey: "js-system/storefront/products/product-1/new",
      publicId: "js-system/storefront/products/product-1/new",
      resourceType: "image",
      storageProvider: "cloudinary",
      format: "jpg",
      bytes: 100,
      width: 1000,
      height: 800
    });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        productMedia: {
          updateMany: vi.fn(),
          update: vi.fn().mockResolvedValue({ id: "media-1", url: "https://res.cloudinary.com/demo/image/upload/v1/new.jpg" })
        }
      })
    );

    const { storefrontMediaService } = await import("../src/modules/storefront/storefront-media.service.js");

    const result = await storefrontMediaService.replaceProductMedia({
      organizationId: "org-1",
      userId: "user-1",
      productId: "product-1",
      mediaId: "media-1",
      file: {
        buffer: Buffer.from("image"),
        originalname: "sample.jpg",
        mimetype: "image/jpeg",
        size: 5
      }
    });

    expect(result).toMatchObject({ id: "media-1" });
    expect(storageMock.deleteStoredFile).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: "legacy.jpg",
        storageProvider: "local",
        url: "/uploads/legacy.jpg"
      })
    );
  });
});
