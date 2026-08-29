import { ProductMediaType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import { logger } from "../../config/logger.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { prisma } from "../../lib/prisma.js";
import { buildProductMediaFolderSegments, storageService, type StorageUploadFile } from "../../services/storage.service.js";

type UploadProductMediaInput = {
  organizationId: string;
  userId: string;
  productId: string;
  file: StorageUploadFile;
  productVariantId?: string | null;
  altText?: string | null;
  title?: string | null;
  displayOrder?: number;
  isPrimary?: boolean;
  isPublished?: boolean;
};

type ReplaceProductMediaInput = UploadProductMediaInput & {
  mediaId: string;
};

type UpdateProductMediaInput = {
  organizationId: string;
  mediaId: string;
  altText?: string | null;
  title?: string | null;
  displayOrder?: number;
  isPrimary?: boolean;
  isPublished?: boolean;
};

const findProduct = async (organizationId: string, productId: string) => {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      organizationId
    },
    select: { id: true }
  });

  if (!product) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found", StatusCodes.NOT_FOUND);
  }
};

const findMedia = async (organizationId: string, mediaId: string) => {
  const media = await prisma.productMedia.findFirst({
    where: {
      id: mediaId,
      organizationId
    }
  });

  if (!media) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Media asset not found", StatusCodes.NOT_FOUND);
  }

  return media;
};

export const storefrontMediaService = {
  async uploadProductMedia(input: UploadProductMediaInput) {
    await findProduct(input.organizationId, input.productId);

    logger.info(
      {
        organizationId: input.organizationId,
        productId: input.productId,
        storageProvider: storageService.provider.name
      },
      "Product media upload started"
    );

    const storedFile = await storageService.uploadFile({
      file: input.file,
      category: "product-image",
      folderSegments: buildProductMediaFolderSegments(input.productId),
      publicIdPrefix: "product-media"
    });

    try {
      const media = await prisma.$transaction(async (tx) => {
        if (input.isPrimary) {
          await tx.productMedia.updateMany({
            where: {
              organizationId: input.organizationId,
              productId: input.productId
            },
            data: {
              isPrimary: false
            }
          });
        }

        return tx.productMedia.create({
          data: {
            organizationId: input.organizationId,
            productId: input.productId,
            productVariantId: input.productVariantId ?? null,
            type: ProductMediaType.IMAGE,
            url: storedFile.secureUrl,
            storageKey: storedFile.storageKey,
            storageProvider: storedFile.storageProvider,
            resourceType: storedFile.resourceType,
            format: storedFile.format ?? null,
            bytes: storedFile.bytes ?? null,
            width: storedFile.width ?? null,
            height: storedFile.height ?? null,
            altText: input.altText ?? null,
            title: input.title ?? null,
            displayOrder: input.displayOrder ?? 0,
            isPrimary: input.isPrimary ?? false,
            isPublished: input.isPublished ?? true,
            createdById: input.userId
          }
        });
      });

      logger.info(
        {
          mediaId: media.id,
          organizationId: input.organizationId,
          productId: input.productId,
          storageProvider: storedFile.storageProvider,
          publicId: storedFile.publicId
        },
        "Product media upload completed"
      );

      return media;
    } catch (error) {
      logger.error(
        {
          err: error,
          organizationId: input.organizationId,
          productId: input.productId,
          storageProvider: storedFile.storageProvider,
          publicId: storedFile.publicId
        },
        "Product media upload failed after storage upload"
      );

      try {
        logger.warn(
          {
            organizationId: input.organizationId,
            productId: input.productId,
            storageProvider: storedFile.storageProvider,
            publicId: storedFile.publicId
          },
          "Product media upload compensation cleanup attempted"
        );
        await storageService.deleteStoredFile(storedFile);
      } catch (cleanupError) {
        logger.error(
          {
            err: cleanupError,
            organizationId: input.organizationId,
            productId: input.productId,
            storageProvider: storedFile.storageProvider,
            publicId: storedFile.publicId
          },
          "Product media upload compensation cleanup failed"
        );
      }

      throw error;
    }
  },

  async updateProductMedia(input: UpdateProductMediaInput) {
    const media = await findMedia(input.organizationId, input.mediaId);

    if (input.isPrimary) {
      await prisma.productMedia.updateMany({
        where: {
          organizationId: input.organizationId,
          productId: media.productId
        },
        data: {
          isPrimary: false
        }
      });
    }

    return prisma.productMedia.update({
      where: { id: input.mediaId },
      data: {
        altText: input.altText ?? media.altText,
        title: input.title ?? media.title,
        displayOrder: input.displayOrder ?? media.displayOrder,
        isPrimary: input.isPrimary ?? media.isPrimary,
        isPublished: input.isPublished ?? media.isPublished
      }
    });
  },

  async replaceProductMedia(input: ReplaceProductMediaInput) {
    const existing = await findMedia(input.organizationId, input.mediaId);
    const storedFile = await storageService.uploadFile({
      file: input.file,
      category: "product-image",
      folderSegments: buildProductMediaFolderSegments(existing.productId),
      publicIdPrefix: "product-media"
    });

    let updated;

    try {
      updated = await prisma.$transaction(async (tx) => {
        const nextIsPrimary = input.isPrimary ?? existing.isPrimary;

        if (nextIsPrimary) {
          await tx.productMedia.updateMany({
            where: {
              organizationId: input.organizationId,
              productId: existing.productId
            },
            data: {
              isPrimary: false
            }
          });
        }

        return tx.productMedia.update({
          where: { id: input.mediaId },
          data: {
            productVariantId: input.productVariantId ?? existing.productVariantId,
            type: ProductMediaType.IMAGE,
            url: storedFile.secureUrl,
            storageKey: storedFile.storageKey,
            storageProvider: storedFile.storageProvider,
            resourceType: storedFile.resourceType,
            format: storedFile.format ?? null,
            bytes: storedFile.bytes ?? null,
            width: storedFile.width ?? null,
            height: storedFile.height ?? null,
            altText: input.altText ?? existing.altText,
            title: input.title ?? existing.title,
            displayOrder: input.displayOrder ?? existing.displayOrder,
            isPrimary: nextIsPrimary,
            isPublished: input.isPublished ?? existing.isPublished
          }
        });
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          mediaId: input.mediaId,
          organizationId: input.organizationId,
          productId: existing.productId,
          storageProvider: storedFile.storageProvider,
          publicId: storedFile.publicId
        },
        "Product media replacement failed after storage upload"
      );

      try {
        logger.warn(
          {
            mediaId: input.mediaId,
            organizationId: input.organizationId,
            productId: existing.productId,
            storageProvider: storedFile.storageProvider,
            publicId: storedFile.publicId
          },
          "Product media replacement compensation cleanup attempted"
        );
        await storageService.deleteStoredFile(storedFile);
      } catch (cleanupError) {
        logger.error(
          {
            err: cleanupError,
            mediaId: input.mediaId,
            organizationId: input.organizationId,
            productId: existing.productId,
            storageProvider: storedFile.storageProvider,
            publicId: storedFile.publicId
          },
          "Product media replacement compensation cleanup failed"
        );
      }

      throw error;
    }

    try {
      await storageService.deleteStoredFile(existing);
      logger.info(
        {
          mediaId: updated.id,
          organizationId: input.organizationId,
          productId: existing.productId,
          storageProvider: storedFile.storageProvider,
          publicId: storedFile.publicId
        },
        "Product media replacement completed"
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          mediaId: updated.id,
          organizationId: input.organizationId,
          productId: existing.productId,
          previousStorageProvider: existing.storageProvider ?? null,
          previousStorageKey: existing.storageKey ?? null
        },
        "Product media replacement previous asset cleanup failed"
      );
    }

    return updated;
  },

  async deleteProductMedia(organizationId: string, mediaId: string) {
    const media = await findMedia(organizationId, mediaId);

    await prisma.productMedia.delete({
      where: { id: mediaId }
    });

    try {
      await storageService.deleteStoredFile(media);
      logger.info(
        {
          mediaId,
          organizationId,
          productId: media.productId,
          storageProvider: media.storageProvider ?? null,
          storageKey: media.storageKey ?? null
        },
        "Product media deletion completed"
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          mediaId,
          organizationId,
          productId: media.productId,
          storageProvider: media.storageProvider ?? null,
          storageKey: media.storageKey ?? null
        },
        "Product media deletion asset cleanup failed"
      );
    }
  }
};
