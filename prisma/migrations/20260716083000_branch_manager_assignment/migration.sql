ALTER TABLE "Branch"
ADD COLUMN "managerUserId" TEXT;

ALTER TABLE "Branch"
ADD CONSTRAINT "Branch_managerUserId_fkey"
FOREIGN KEY ("managerUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Branch_managerUserId_key" ON "Branch"("managerUserId");
