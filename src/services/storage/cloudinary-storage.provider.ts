import { randomUUID } from "crypto";

import { v2 as cloudinary, type UploadApiErrorResponse, type UploadApiResponse } from "cloudinary";
import { StatusCodes } from "http-status-codes";

import { env } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { sanitizeStoragePathSegment } from "./storage-paths.js";
import { validateUploadInput } from "./media-validation.js";
import type { DeleteFileOptions, StorageProvider, StoredFile, UploadFileInput } from "./storage.types.js";

const CLOUDINARY_DUPLICATE_ERROR = "already exists";

const toStoredFile = (result: UploadApiResponse): StoredFile => ({
  url: result.secure_url,
  secureUrl: result.secure_url,
  storageKey: result.public_id,
  publicId: result.public_id,
  resourceType: result.resource_type as StoredFile["resourceType"],
  format: result.format,
  bytes: result.bytes,
  width: result.width,
  height: result.height,
  storageProvider: "cloudinary"
});

type CloudinaryAssetDetails = {
  secureUrl: string;
  bytes?: number;
  width?: number;
  height?: number;
  format?: string;
};

const buildCloudinaryError = (message: string) =>
  new AppError(ERROR_CODES.BAD_REQUEST, message, StatusCodes.BAD_GATEWAY);

export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = "cloudinary" as const;

  constructor() {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: env.CLOUDINARY_SECURE
    });
  }

  async uploadFile(input: UploadFileInput): Promise<StoredFile> {
    const spec = validateUploadInput(input);
    const folder = input.folderSegments.map(sanitizeStoragePathSegment).join("/");
    const publicId = input.publicId
      ? sanitizeStoragePathSegment(input.publicId)
      : `${input.publicIdPrefix ? `${sanitizeStoragePathSegment(input.publicIdPrefix)}-` : ""}${randomUUID()}`;
    const resourceType = input.resourceType ?? spec.resourceType;

    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            public_id: publicId,
            resource_type: resourceType,
            overwrite: false,
            use_filename: false,
            unique_filename: false
          },
          (error, response) => {
            if (error || !response) {
              reject(error ?? new Error("Cloudinary upload failed"));
              return;
            }

            resolve(response);
          }
        );

        stream.on("error", reject);
        stream.end(input.file.buffer);
      });

      return toStoredFile(result);
    } catch (error) {
      if (input.publicId && this.isDuplicateError(error)) {
        const existingAsset = await this.getAssetDetails(publicId, resourceType);
        return {
          url: existingAsset.secureUrl,
          secureUrl: existingAsset.secureUrl,
          storageKey: publicId,
          publicId,
          resourceType,
          format: existingAsset.format,
          bytes: existingAsset.bytes,
          width: existingAsset.width,
          height: existingAsset.height,
          storageProvider: this.name
        };
      }

      throw this.normalizeError(error, "Media upload failed");
    }
  }

  async deleteFile(storageKey: string, options?: DeleteFileOptions) {
    const resourceType = options?.resourceType === "raw" || options?.resourceType === "video"
      ? options.resourceType
      : "image";

    try {
      const result = await cloudinary.uploader.destroy(storageKey, {
        resource_type: resourceType,
        invalidate: true
      });

      if (result.result !== "ok" && result.result !== "not found") {
        throw new Error(`Unexpected Cloudinary delete result: ${result.result}`);
      }
    } catch (error) {
      throw this.normalizeError(error, "Media deletion failed");
    }
  }

  private async getAssetDetails(publicId: string, resourceType: "image" | "raw" | "video"): Promise<CloudinaryAssetDetails> {
    try {
      const result = await cloudinary.api.resource(publicId, {
        resource_type: resourceType
      });

      return {
        secureUrl: result.secure_url as string,
        bytes: result.bytes as number | undefined,
        width: result.width as number | undefined,
        height: result.height as number | undefined,
        format: result.format as string | undefined
      };
    } catch (error) {
      throw this.normalizeError(error, "Cloudinary asset lookup failed");
    }
  }

  private normalizeError(error: unknown, fallbackMessage: string) {
    const candidate = error as UploadApiErrorResponse | { message?: string } | undefined;
    const message = candidate?.message?.toLowerCase().includes(CLOUDINARY_DUPLICATE_ERROR)
      ? "Media asset already exists"
      : fallbackMessage;

    return buildCloudinaryError(message);
  }

  private isDuplicateError(error: unknown) {
    const candidate = error as UploadApiErrorResponse | { message?: string } | undefined;
    return candidate?.message?.toLowerCase().includes(CLOUDINARY_DUPLICATE_ERROR) ?? false;
  }
}
