export type StorageProviderName = "local" | "cloudinary";

export type StorageResourceType = "image" | "raw" | "video";

export type StorageMediaCategory =
  | "product-image"
  | "category-image"
  | "banner-image"
  | "avatar"
  | "logo"
  | "image-attachment"
  | "document";

export interface StorageUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadFileInput {
  file: StorageUploadFile;
  category: StorageMediaCategory;
  folderSegments: string[];
  publicId?: string;
  publicIdPrefix?: string;
  resourceType?: StorageResourceType;
}

export interface StoredFile {
  url: string;
  secureUrl: string;
  storageKey: string;
  publicId: string;
  resourceType: StorageResourceType;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  storageProvider: StorageProviderName;
}

export interface DeleteFileOptions {
  resourceType?: string | null;
  storageProvider?: string | null;
  url?: string | null;
}

export interface StoredFileReference {
  storageKey?: string | null;
  resourceType?: string | null;
  storageProvider?: string | null;
  url?: string | null;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  uploadFile(input: UploadFileInput): Promise<StoredFile>;
  deleteFile(storageKey: string, options?: DeleteFileOptions): Promise<void>;
}
