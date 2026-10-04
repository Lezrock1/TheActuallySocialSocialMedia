ALTER TABLE "Message" ADD COLUMN "isEncrypted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EncryptionKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncryptionKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EncryptionKey_userId_fingerprint_key" ON "EncryptionKey"("userId", "fingerprint");
CREATE INDEX "EncryptionKey_userId_idx" ON "EncryptionKey"("userId");

ALTER TABLE "EncryptionKey" ADD CONSTRAINT "EncryptionKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;