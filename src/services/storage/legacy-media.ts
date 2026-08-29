import path from "path";

import { env } from "../../config/env.js";
import { buildStorageFolderSegments } from "./storage-paths.js";
import type { StoredFileReference, StorageProviderName } from "./storage.types.js";

const UPLOADS_PREFIX = "/uploads/";

const isAbsoluteUrl = (value: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

export const isLegacyUploadUrl = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  if (value.startsWith(UPLOADS_PREFIX)) {
    return true;
  }

  if (!isAbsoluteUrl(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.pathname.startsWith(UPLOADS_PREFIX);
  } catch {
    return false;
  }
};

export const resolveLegacyLocalStorageKey = (reference: StoredFileReference) => {
  if (reference.storageKey) {
    return reference.storageKey;
  }

  if (!reference.url || !isLegacyUploadUrl(reference.url)) {
    return null;
  }

  try {
    if (reference.url.startsWith("/")) {
      return path.basename(reference.url);
    }

    const parsed = new URL(reference.url);
    return path.basename(parsed.pathname);
  } catch {
    return path.basename(reference.url);
  }
};

export const resolveStoredFileProvider = (reference: StoredFileReference): StorageProviderName => {
  if (reference.storageProvider === "cloudinary" || reference.storageProvider === "local") {
    return reference.storageProvider;
  }

  if (reference.storageKey && reference.storageKey.includes("/")) {
    return "cloudinary";
  }

  if (isLegacyUploadUrl(reference.url)) {
    return "local";
  }

  return "local";
};

export const resolvePublicMediaUrl = (value: string | null | undefined) => {
  if (!value) {
    return value ?? null;
  }

  if (isLegacyUploadUrl(value)) {
    const origin = new URL(env.API_BASE_URL).origin;
    const pathname = value.startsWith("/") ? value : new URL(value).pathname;
    return `${origin}${pathname}`;
  }

  return value;
};

export const buildProductMediaFolderSegments = (productId: string) =>
  buildStorageFolderSegments(env.CLOUDINARY_FOLDER, "storefront", "products", productId);
