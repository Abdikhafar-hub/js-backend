CREATE TYPE "InvoiceType" AS ENUM ('STANDARD', 'PRO_FORMA', 'DEPOSIT', 'FINAL', 'WHOLESALE');

CREATE TYPE "InvoiceSource" AS ENUM (
  'MANUAL',
  'POS',
  'COMPLETED_SALE',
  'WHOLESALE_ORDER',
  'SALES_ORDER',
  'QUOTATION_CONVERSION',
  'ONLINE_ORDER'
);

ALTER TABLE "Invoice"
ADD COLUMN "billingAddress" TEXT,
ADD COLUMN "branchId" TEXT,
ADD COLUMN "contactPerson" TEXT,
ADD COLUMN "createdById" TEXT,
ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'KES',
ADD COLUMN "customerPurchaseOrderRef" TEXT,
ADD COLUMN "deliveryInstructions" TEXT,
ADD COLUMN "deliveryMethod" TEXT,
ADD COLUMN "expectedDeliveryDate" TIMESTAMP(3),
ADD COLUMN "externalReference" TEXT,
ADD COLUMN "invoiceType" "InvoiceType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN "issuedAt" TIMESTAMP(3),
ADD COLUMN "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "shippingAddress" TEXT,
ADD COLUMN "source" "InvoiceSource" NOT NULL DEFAULT 'MANUAL';

UPDATE "Invoice" AS "inv"
SET
  "branchId" = "sale"."branchId",
  "createdById" = "sale"."attendantId",
  "currencyCode" = COALESCE("sale"."currencyCode", 'KES'),
  "paymentTermsDays" = COALESCE("customer"."paymentTermsDays", 0),
  "source" = CASE
    WHEN "sale"."saleType" = 'WHOLESALE' THEN 'WHOLESALE_ORDER'::"InvoiceSource"
    ELSE 'COMPLETED_SALE'::"InvoiceSource"
  END,
  "invoiceType" = CASE
    WHEN "sale"."saleType" = 'WHOLESALE' THEN 'WHOLESALE'::"InvoiceType"
    ELSE 'STANDARD'::"InvoiceType"
  END,
  "issuedAt" = COALESCE("inv"."issueDate", "inv"."createdAt")
FROM "Sale" AS "sale"
LEFT JOIN "Customer" AS "customer" ON "customer"."id" = "inv"."customerId"
WHERE "inv"."saleId" = "sale"."id";

CREATE TABLE "DocumentSequence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT,
  "documentType" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "DocumentSequence"
ADD CONSTRAINT "DocumentSequence_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "DocumentSequence"
ADD CONSTRAINT "DocumentSequence_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DocumentSequence_organizationId_branchId_documentType_year_key"
ON "DocumentSequence"("organizationId", "branchId", "documentType", "year");

CREATE INDEX "DocumentSequence_organizationId_documentType_year_idx"
ON "DocumentSequence"("organizationId", "documentType", "year");

CREATE INDEX "Invoice_organizationId_branchId_status_dueDate_idx"
ON "Invoice"("organizationId", "branchId", "status", "dueDate");

CREATE INDEX "Invoice_organizationId_invoiceType_source_createdAt_idx"
ON "Invoice"("organizationId", "invoiceType", "source", "createdAt");
