CREATE TYPE "ReturnRequestStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'INSPECTED', 'APPROVED', 'REJECTED', 'COMPLETED');
CREATE TYPE "ReturnItemCondition" AS ENUM ('SEALED', 'OPENED', 'DAMAGED', 'DEFECTIVE');
CREATE TYPE "ReturnDisposition" AS ENUM ('RESTOCK', 'QUARANTINE', 'REJECT');
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED');
CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'MPESA', 'STORE_CREDIT', 'CREDIT_NOTE', 'BANK_TRANSFER');
CREATE TYPE "ExchangeStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED');
CREATE TYPE "DiscountRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'EXPIRED');

CREATE TABLE "ReturnRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "returnNumber" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "customerId" TEXT,
  "status" "ReturnRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" TEXT NOT NULL,
  "requestedRefundMethod" "RefundMethod",
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "inspectedById" TEXT,
  "approvedById" TEXT,
  "rejectedById" TEXT,
  "reviewNotes" TEXT,
  "inspectionNotes" TEXT,
  "rejectionReason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "inspectedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReturnRequestItem" (
  "id" TEXT NOT NULL,
  "returnRequestId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "productVariantId" TEXT NOT NULL,
  "quantity" DECIMAL(18,2) NOT NULL,
  "originalUnitPrice" DECIMAL(18,2) NOT NULL,
  "eligibleValue" DECIMAL(18,2) NOT NULL,
  "condition" "ReturnItemCondition" NOT NULL DEFAULT 'SEALED',
  "disposition" "ReturnDisposition",
  "restockEligible" BOOLEAN NOT NULL DEFAULT false,
  "inspectionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnRequestItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "refundNumber" TEXT NOT NULL,
  "returnRequestId" TEXT NOT NULL,
  "originalSaleId" TEXT NOT NULL,
  "originalPaymentId" TEXT,
  "customerId" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "method" "RefundMethod" NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "processedById" TEXT,
  "rejectedById" TEXT,
  "providerReference" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Exchange" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "exchangeNumber" TEXT NOT NULL,
  "returnRequestId" TEXT NOT NULL,
  "originalSaleId" TEXT NOT NULL,
  "replacementSaleId" TEXT,
  "customerId" TEXT,
  "originalValue" DECIMAL(18,2) NOT NULL,
  "replacementValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "differenceAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" "ExchangeStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "completedById" TEXT,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscountRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "saleId" TEXT,
  "cartReference" TEXT NOT NULL,
  "requestedPercent" DECIMAL(5,2),
  "requestedAmount" DECIMAL(18,2),
  "reason" TEXT NOT NULL,
  "status" "DiscountRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "rejectedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscountRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerLedgerEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "balanceBefore" DECIMAL(18,2) NOT NULL,
  "balanceAfter" DECIMAL(18,2) NOT NULL,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReturnRequest_organizationId_returnNumber_key" ON "ReturnRequest"("organizationId", "returnNumber");
CREATE INDEX "ReturnRequest_organizationId_branchId_status_requestedAt_idx" ON "ReturnRequest"("organizationId", "branchId", "status", "requestedAt");
CREATE INDEX "ReturnRequest_saleId_idx" ON "ReturnRequest"("saleId");
CREATE INDEX "ReturnRequestItem_returnRequestId_idx" ON "ReturnRequestItem"("returnRequestId");
CREATE INDEX "ReturnRequestItem_saleItemId_idx" ON "ReturnRequestItem"("saleItemId");
CREATE UNIQUE INDEX "Refund_organizationId_refundNumber_key" ON "Refund"("organizationId", "refundNumber");
CREATE INDEX "Refund_organizationId_branchId_status_requestedAt_idx" ON "Refund"("organizationId", "branchId", "status", "requestedAt");
CREATE INDEX "Refund_returnRequestId_idx" ON "Refund"("returnRequestId");
CREATE UNIQUE INDEX "Exchange_organizationId_exchangeNumber_key" ON "Exchange"("organizationId", "exchangeNumber");
CREATE INDEX "Exchange_organizationId_branchId_status_idx" ON "Exchange"("organizationId", "branchId", "status");
CREATE INDEX "DiscountRequest_organizationId_branchId_status_idx" ON "DiscountRequest"("organizationId", "branchId", "status");
CREATE INDEX "DiscountRequest_cartReference_idx" ON "DiscountRequest"("cartReference");
CREATE INDEX "CustomerLedgerEntry_organizationId_customerId_createdAt_idx" ON "CustomerLedgerEntry"("organizationId", "customerId", "createdAt");
CREATE UNIQUE INDEX "CustomerLedgerEntry_customerId_referenceType_referenceId_entryType_key" ON "CustomerLedgerEntry"("customerId", "referenceType", "referenceId", "entryType");

ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReturnRequestItem" ADD CONSTRAINT "ReturnRequestItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnRequestItem" ADD CONSTRAINT "ReturnRequestItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnRequestItem" ADD CONSTRAINT "ReturnRequestItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_originalSaleId_fkey" FOREIGN KEY ("originalSaleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_originalPaymentId_fkey" FOREIGN KEY ("originalPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_originalSaleId_fkey" FOREIGN KEY ("originalSaleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_replacementSaleId_fkey" FOREIGN KEY ("replacementSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
