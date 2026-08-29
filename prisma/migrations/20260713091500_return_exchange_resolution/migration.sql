CREATE TYPE "ReturnResolution" AS ENUM ('REFUND', 'EXCHANGE');

ALTER TABLE "ReturnRequest"
ADD COLUMN "resolution" "ReturnResolution" NOT NULL DEFAULT 'REFUND';
