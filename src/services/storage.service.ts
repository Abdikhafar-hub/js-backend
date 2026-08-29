import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { CloudinaryStorageProvider } from "./storage/cloudinary-storage.provider.js";
import { LocalStorageProvider } from "./storage/local-storage.provider.js";
import { resolveLegacyLocalStorageKey, resolveStoredFileProvider } from "./storage/legacy-media.js";
import type {
  DeleteFileOptions,
  StorageProvider,
  StoredFileReference,
  StorageProviderName
} from "./storage/storage.types.js";

export type * from "./storage/storage.types.js";
export { buildProductMediaFolderSegments, isLegacyUploadUrl, resolveLegacyLocalStorageKey, resolvePublicMediaUrl } from "./storage/legacy-media.js";

const providerFactories: Record<StorageProviderName, () => StorageProvider> = {
  local: () => new LocalStorageProvider(),
  cloudinary: () => new CloudinaryStorageProvider()
};

const providerCache = new Map<StorageProviderName, StorageProvider>();

export const getStorageProvider = (providerName = env.STORAGE_PROVIDER): StorageProvider => {
  const name = providerName as StorageProviderName;
  const factory = providerFactories[name];

  if (!factory) {
    throw new Error(`Unsupported storage provider: ${providerName}`);
  }

  const cached = providerCache.get(name);
  if (cached) {
    return cached;
  }

  const provider = factory();
  providerCache.set(name, provider);
  return provider;
};

export const storageService = {
  get provider() {
    return getStorageProvider();
  },

  async uploadFile(input: Parameters<StorageProvider["uploadFile"]>[0]) {
    return this.provider.uploadFile(input);
  },

  async deleteFile(storageKey: string, options?: DeleteFileOptions) {
    return this.provider.deleteFile(storageKey, options);
  },

  async deleteStoredFile(reference: StoredFileReference) {
    const providerName = resolveStoredFileProvider(reference);
    const provider = getStorageProvider(providerName);
    const storageKey = providerName === "local" ? resolveLegacyLocalStorageKey(reference) : reference.storageKey;

    if (!storageKey) {
      return;
    }

    try {
      await provider.deleteFile(storageKey, {
        resourceType: reference.resourceType,
        storageProvider: providerName,
        url: reference.url
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          storageProvider: providerName,
          storageKey,
          resourceType: reference.resourceType ?? null
        },
        "Storage deletion failed"
      );
      throw error;
    }
  }
};
