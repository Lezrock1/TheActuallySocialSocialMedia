-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN "maxUses" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;

-- Already redeemed single-use links stay closed; open member links get the new allowance.
UPDATE "Invitation" SET "useCount" = 1 WHERE "redeemedAt" IS NOT NULL;
UPDATE "Invitation" SET "maxUses" = 5 WHERE "redeemedAt" IS NULL AND "inviterId" IS NOT NULL;
