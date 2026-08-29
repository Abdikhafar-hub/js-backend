ALTER TABLE "OrganizationSetting"
ADD COLUMN "maximumBranchManagerRefund" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "Customer"
ADD COLUMN "storeCreditBalance" DECIMAL(18,2) NOT NULL DEFAULT 0;
