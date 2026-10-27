ALTER TABLE "User" ADD COLUMN "hiddenExternalPlatforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "ExternalRepost" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "authorHandle" TEXT NOT NULL,
  "authorName" TEXT,
  "authorAvatarUrl" TEXT,
  "profileUrl" TEXT NOT NULL,
  "text" TEXT,
  "mediaUrl" TEXT,
  "thumbnailUrl" TEXT,
  "url" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalRepost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalRepost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExternalRepost_userId_platform_externalId_url_key" ON "ExternalRepost"("userId", "platform", "externalId", "url");
CREATE INDEX "ExternalRepost_userId_createdAt_id_idx" ON "ExternalRepost"("userId", "createdAt", "id");