ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

DO $$
BEGIN
  CREATE TYPE "RefundType" AS ENUM (
    'FULL_ORDER',
    'PARTIAL_ITEM',
    'PARTIAL_AMOUNT',
    'DELIVERY_FEE',
    'OVERPAYMENT',
    'DUPLICATE_PAYMENT',
    'PRICE_CORRECTION',
    'CANCELLED_ORDER',
    'GOODWILL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "OrganizationSetting"
ADD COLUMN IF NOT EXISTS "maximumGeneralManagerRefund" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "Refund"
ALTER COLUMN "refundNumber" DROP NOT NULL,
ALTER COLUMN "returnRequestId" DROP NOT NULL,
ALTER COLUMN "amount" SET DEFAULT 0;

ALTER TABLE "Refund"
ADD COLUMN IF NOT EXISTS "originalInvoiceId" TEXT,
ADD COLUMN IF NOT EXISTS "eligibleAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "approvedAmount" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "refundType" "RefundType" NOT NULL DEFAULT 'PARTIAL_ITEM',
ADD COLUMN IF NOT EXISTS "detailedReason" TEXT,
ADD COLUMN IF NOT EXISTS "approvalNote" TEXT,
ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
ADD COLUMN IF NOT EXISTS "correctionInstructions" TEXT,
ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
ADD COLUMN IF NOT EXISTS "providerStatus" TEXT,
ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

UPDATE "Refund"
SET
  "eligibleAmount" = COALESCE("eligibleAmount", "amount"),
  "refundType" = COALESCE("refundType", 'PARTIAL_ITEM'::"RefundType"),
  "detailedReason" = COALESCE("detailedReason", "reason")
WHERE "eligibleAmount" = 0
   OR "refundType" IS NULL
   OR "detailedReason" IS NULL;

ALTER TABLE "Refund" DROP CONSTRAINT IF EXISTS "Refund_returnRequestId_fkey";
ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_returnRequestId_fkey"
FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_originalInvoiceId_fkey"
FOREIGN KEY ("originalInvoiceId") REFERENCES "Invoice"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "RefundItem" (
  "id" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "productVariantId" TEXT NOT NULL,
  "quantity" DECIMAL(18,2) NOT NULL,
  "originalQuantity" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "previouslyReturnedQuantity" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "previouslyRefundedQuantity" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "remainingRefundableQuantity" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "originalUnitPrice" DECIMAL(18,2) NOT NULL,
  "lineDiscountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "eligibleLineAmount" DECIMAL(18,2) NOT NULL,
  "requestedLineAmount" DECIMAL(18,2) NOT NULL,
  "reason" TEXT,
  "condition" "ReturnItemCondition" NOT NULL DEFAULT 'SEALED',
  "restockDisposition" "ReturnDisposition",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RefundItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RefundItem_refundId_idx" ON "RefundItem"("refundId");
CREATE INDEX IF NOT EXISTS "RefundItem_saleItemId_idx" ON "RefundItem"("saleItemId");

ALTER TABLE "RefundItem"
ADD CONSTRAINT "RefundItem_refundId_fkey"
FOREIGN KEY ("refundId") REFERENCES "Refund"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefundItem"
ADD CONSTRAINT "RefundItem_saleItemId_fkey"
FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefundItem"
ADD CONSTRAINT "RefundItem_productVariantId_fkey"
FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
