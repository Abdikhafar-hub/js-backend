import fs from "fs";
import path from "path";

import { prisma } from "../src/lib/prisma.js";
import { logger } from "../src/config/logger.js";
import { buildProductMediaFolderSegments, getStorageProvider, isLegacyUploadUrl, resolveLegacyLocalStorageKey } from "../src/services/storage.service.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const uploadsDir = path.join(process.cwd(), "uploads");
const cloudinaryProvider = getStorageProvider("cloudinary");

const mimeTypesByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".pdf": "application/pdf"
};

const summary = {
  scanned: 0,
  migrated: 0,
  skipped: 0,
  missing: 0,
  failed: 0
};

const report = [] as string[];

const run = async () => {
  const mediaRecords = await prisma.productMedia.findMany({
    where: {
      OR: [
        { storageProvider: null },
        { storageProvider: "local" }
      ]
    },
    orderBy: { createdAt: "asc" }
  });

  for (const media of mediaRecords) {
    summary.scanned += 1;

    if (!isLegacyUploadUrl(media.url)) {
      summary.skipped += 1;
      report.push(`SKIP ${media.id}: non-local url`);
      logger.info({ mediaId: media.id, url: media.url }, "Legacy media migration skipped");
      continue;
    }

    const localKey = resolveLegacyLocalStorageKey(media);
    if (!localKey) {
      summary.skipped += 1;
      report.push(`SKIP ${media.id}: missing local key`);
      logger.info({ mediaId: media.id }, "Legacy media migration skipped");
      continue;
    }

    const absoluteFilePath = path.join(uploadsDir, localKey);
    if (!fs.existsSync(absoluteFilePath)) {
      summary.missing += 1;
      report.push(`MISS ${media.id}: ${absoluteFilePath}`);
      logger.warn({ mediaId: media.id, path: absoluteFilePath }, "Legacy media migration skipped due to missing file");
      continue;
    }

    if (media.storageProvider === "cloudinary") {
      summary.skipped += 1;
      report.push(`SKIP ${media.id}: already cloudinary`);
      continue;
    }

    const buffer = await fs.promises.readFile(absoluteFilePath);
    const mimetype = mimeTypesByExtension[path.extname(absoluteFilePath).toLowerCase()];
    const folderSegments = buildProductMediaFolderSegments(media.productId);
    const publicId = `product-media-${media.id}`;

    if (!mimetype) {
      summary.skipped += 1;
      report.push(`SKIP ${media.id}: unsupported extension`);
      logger.warn({ mediaId: media.id, path: absoluteFilePath }, "Legacy media migration skipped due to unsupported extension");
      continue;
    }

    if (dryRun) {
      summary.skipped += 1;
      report.push(`DRY ${media.id}: ${absoluteFilePath} -> ${folderSegments.join("/")}/${publicId}`);
      logger.info({ mediaId: media.id, path: absoluteFilePath }, "Legacy media migration dry run");
      continue;
    }

    try {
      const uploaded = await cloudinaryProvider.uploadFile({
        file: {
          buffer,
          originalname: path.basename(absoluteFilePath),
          mimetype,
          size: buffer.byteLength
        },
        category: mimetype === "application/pdf" ? "document" : "product-image",
        folderSegments,
        publicId
      });

      await prisma.productMedia.update({
        where: { id: media.id },
        data: {
          url: uploaded.secureUrl,
          storageKey: uploaded.storageKey,
          storageProvider: uploaded.storageProvider,
          resourceType: uploaded.resourceType,
          format: uploaded.format ?? null,
          bytes: uploaded.bytes ?? null,
          width: uploaded.width ?? null,
          height: uploaded.height ?? null
        }
      });

      summary.migrated += 1;
      report.push(`DONE ${media.id}: ${absoluteFilePath} -> ${uploaded.storageKey}`);
      logger.info(
        {
          mediaId: media.id,
          productId: media.productId,
          storageProvider: uploaded.storageProvider,
          publicId: uploaded.publicId
        },
        "Legacy media migration uploaded"
      );
    } catch (error) {
      summary.failed += 1;
      report.push(`FAIL ${media.id}: ${(error as Error).message}`);
      logger.error(
        {
          err: error,
          mediaId: media.id,
          productId: media.productId
        },
        "Legacy media migration failed"
      );
    }
  }

  process.stdout.write(`${report.join("\n")}\n`);
  process.stdout.write(
    `Summary: scanned=${summary.scanned} migrated=${summary.migrated} skipped=${summary.skipped} missing=${summary.missing} failed=${summary.failed}\n`
  );
};

run()
  .catch((error) => {
    logger.error({ err: error }, "Legacy media migration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
