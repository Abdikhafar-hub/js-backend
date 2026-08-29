import path from "path";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import type {
  StorageMediaCategory,
  StorageResourceType,
  StorageUploadFile,
  UploadFileInput
} from "./storage.types.js";

type AllowedMediaSpec = {
  resourceType: StorageResourceType;
  mimeTypes: readonly string[];
  extensions: readonly string[];
};

const IMAGE_SPEC: AllowedMediaSpec = {
  resourceType: "image",
  mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
  extensions: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]
};

const DOCUMENT_SPEC: AllowedMediaSpec = {
  resourceType: "raw",
  mimeTypes: [
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ],
  extensions: [".pdf", ".txt", ".csv", ".doc", ".docx", ".xls", ".xlsx"]
};

const categorySpecs: Record<StorageMediaCategory, AllowedMediaSpec> = {
  "product-image": IMAGE_SPEC,
  "category-image": IMAGE_SPEC,
  "banner-image": IMAGE_SPEC,
  avatar: IMAGE_SPEC,
  logo: IMAGE_SPEC,
  "image-attachment": IMAGE_SPEC,
  document: DOCUMENT_SPEC
};

const fileExtension = (filename: string) => path.extname(filename).toLowerCase();

const buildInvalidFileError = (message: string) =>
  new AppError(ERROR_CODES.VALIDATION_ERROR, message, StatusCodes.BAD_REQUEST);

export const getAllowedMediaSpec = (category: StorageMediaCategory) => categorySpecs[category];

export const validateUploadFile = (file: StorageUploadFile, category: StorageMediaCategory) => {
  const spec = getAllowedMediaSpec(category);
  const extension = fileExtension(file.originalname);

  if (!spec.mimeTypes.includes(file.mimetype)) {
    throw buildInvalidFileError("Unsupported file type");
  }

  if (!spec.extensions.includes(extension)) {
    throw buildInvalidFileError("Unsupported file extension");
  }

  if (file.mimetype === "image/svg+xml" || extension === ".svg") {
    throw buildInvalidFileError("SVG uploads are not supported");
  }

  return spec;
};

export const validateUploadInput = (input: UploadFileInput) => {
  return validateUploadFile(input.file, input.category);
};
