ALTER TABLE "ProductMedia"
ADD COLUMN "storageProvider" TEXT,
ADD COLUMN "resourceType" TEXT,
ADD COLUMN "format" TEXT,
ADD COLUMN "bytes" INTEGER,
ADD COLUMN "width" INTEGER,
ADD COLUMN "height" INTEGER;
