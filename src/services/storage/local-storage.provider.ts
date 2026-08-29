import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { env } from "../../config/env.js";
import type { DeleteFileOptions, StorageProvider, StoredFile, UploadFileInput } from "./storage.types.js";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private readonly uploadDir = path.join(process.cwd(), "uploads");
  private readonly publicUrlBase = `${new URL(env.API_BASE_URL).origin}/uploads`;

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(input: UploadFileInput): Promise<StoredFile> {
    const extension = path.extname(input.file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${randomUUID()}${extension}`;
    const filePath = path.join(this.uploadDir, uniqueName);

    await fs.promises.writeFile(filePath, input.file.buffer);

    return {
      url: `${this.publicUrlBase}/${uniqueName}`,
      secureUrl: `${this.publicUrlBase}/${uniqueName}`,
      storageKey: uniqueName,
      publicId: uniqueName,
      resourceType: input.resourceType ?? "image",
      bytes: input.file.size,
      storageProvider: this.name
    };
  }

  async deleteFile(storageKey: string, _options?: DeleteFileOptions) {
    const filePath = path.join(this.uploadDir, storageKey);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }
}
