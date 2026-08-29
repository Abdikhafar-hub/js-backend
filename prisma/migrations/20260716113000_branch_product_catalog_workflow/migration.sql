DO $$
BEGIN
  CREATE TYPE "ProductType" AS ENUM ('PERFUME', 'OUD', 'BAKHOOR', 'BURNER', 'LOTION', 'BODY_SPRAY', 'OIL', 'GIFT_SET', 'BANNER', 'ACCESSORIES', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ProductApprovalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "BranchProductStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'CORRECTION_REQUIRED', 'REJECTED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ProductSubmissionType" AS ENUM ('NEW_PRODUCT', 'BRANCH_ACTIVATION', 'MASTER_CHANGE_REQUEST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ProductSubmissionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PriceProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Brand"
  ADD COLUMN IF NOT EXISTS "normalizedName" TEXT;

ALTER TABLE "ProductCategory"
  ADD COLUMN IF NOT EXISTS "normalizedName" TEXT;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "normalizedName" TEXT,
  ADD COLUMN IF NOT EXISTS "internalDisplayName" TEXT,
  ADD COLUMN IF NOT EXISTS "shortDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "fullDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "productType" "ProductType",
  ADD COLUMN IF NOT EXISTS "trackingMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "batchTrackingDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "expiryTrackingDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalStatus" "ProductApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "originatingBranchId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);

ALTER TABLE "ProductVariant"
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "concentrationType" "ConcentrationType",
  ADD COLUMN IF NOT EXISTS "unitOfMeasure" "VolumeUnit";

CREATE TABLE IF NOT EXISTS "BranchProduct" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "priceListId" TEXT,
  "status" "BranchProductStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "sellInBranch" BOOLEAN NOT NULL DEFAULT true,
  "reorderLevel" DECIMAL(18,2),
  "minimumStock" DECIMAL(18,2),
  "maximumStock" DECIMAL(18,2),
  "shelfLocation" TEXT,
  "branchLabel" TEXT,
  "notes" TEXT,
  "introductionDate" TIMESTAMP(3),
  "requestedById" TEXT,
  "requestedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BranchProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductSubmission" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT,
  "branchProductId" TEXT,
  "originatingBranchId" TEXT NOT NULL,
  "submittedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "type" "ProductSubmissionType" NOT NULL DEFAULT 'NEW_PRODUCT',
  "status" "ProductSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "requestedBrandName" TEXT,
  "requestedCategoryName" TEXT,
  "correctionNote" TEXT,
  "requestedChanges" TEXT,
  "rejectionReason" TEXT,
  "duplicateWarnings" JSONB,
  "reviewMetadata" JSONB,
  "submittedSnapshot" JSONB,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductPriceProposal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productVariantId" TEXT,
  "branchId" TEXT NOT NULL,
  "branchProductId" TEXT,
  "submissionId" TEXT,
  "priceListId" TEXT,
  "status" "PriceProposalStatus" NOT NULL DEFAULT 'PROPOSED',
  "proposedRetailPrice" DECIMAL(18,2),
  "proposedWholesalePrice" DECIMAL(18,2),
  "approvedRetailPrice" DECIMAL(18,2),
  "approvedWholesalePrice" DECIMAL(18,2),
  "justification" TEXT,
  "reason" TEXT,
  "proposedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductPriceProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BranchProduct_branchId_productId_key" ON "BranchProduct"("branchId", "productId");
CREATE INDEX IF NOT EXISTS "BranchProduct_organizationId_branchId_status_idx" ON "BranchProduct"("organizationId", "branchId", "status");

CREATE INDEX IF NOT EXISTS "ProductSubmission_organizationId_status_type_idx" ON "ProductSubmission"("organizationId", "status", "type");
CREATE INDEX IF NOT EXISTS "ProductSubmission_originatingBranchId_status_idx" ON "ProductSubmission"("originatingBranchId", "status");

CREATE INDEX IF NOT EXISTS "ProductPriceProposal_organizationId_branchId_status_idx" ON "ProductPriceProposal"("organizationId", "branchId", "status");
CREATE INDEX IF NOT EXISTS "ProductPriceProposal_submissionId_idx" ON "ProductPriceProposal"("submissionId");

CREATE INDEX IF NOT EXISTS "Brand_organizationId_normalizedName_idx" ON "Brand"("organizationId", "normalizedName");
CREATE INDEX IF NOT EXISTS "ProductCategory_organizationId_normalizedName_idx" ON "ProductCategory"("organizationId", "normalizedName");
CREATE INDEX IF NOT EXISTS "Product_organizationId_approvalStatus_idx" ON "Product"("organizationId", "approvalStatus");
CREATE INDEX IF NOT EXISTS "Product_organizationId_normalizedName_idx" ON "Product"("organizationId", "normalizedName");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_originatingBranchId_fkey"
  FOREIGN KEY ("originatingBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductSubmission"
  ADD CONSTRAINT "ProductSubmission_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSubmission"
  ADD CONSTRAINT "ProductSubmission_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductSubmission"
  ADD CONSTRAINT "ProductSubmission_branchProductId_fkey"
  FOREIGN KEY ("branchProductId") REFERENCES "BranchProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductSubmission"
  ADD CONSTRAINT "ProductSubmission_originatingBranchId_fkey"
  FOREIGN KEY ("originatingBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSubmission"
  ADD CONSTRAINT "ProductSubmission_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSubmission"
  ADD CONSTRAINT "ProductSubmission_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_branchProductId_fkey"
  FOREIGN KEY ("branchProductId") REFERENCES "BranchProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "ProductSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_proposedById_fkey"
  FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductPriceProposal"
  ADD CONSTRAINT "ProductPriceProposal_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
