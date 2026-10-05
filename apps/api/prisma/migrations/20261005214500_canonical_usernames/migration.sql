ALTER TABLE "User" ADD COLUMN "usernameCanonical" TEXT;

UPDATE "User" SET "usernameCanonical" = lower("username");

ALTER TABLE "User" ALTER COLUMN "usernameCanonical" SET NOT NULL;
CREATE UNIQUE INDEX "User_usernameCanonical_key" ON "User"("usernameCanonical");