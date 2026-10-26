-- External platform integrations: followed Bluesky/Mastodon/YouTube/Twitch profiles
-- and their cached posts for feed cards and story-bar chips.
CREATE TABLE "ExternalFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "profileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalFollow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalPost" (
    "id" TEXT NOT NULL,
    "followId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "text" TEXT,
    "mediaUrl" TEXT,
    "thumbnailUrl" TEXT,
    "isShort" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalFollow_userId_platform_externalId_key" ON "ExternalFollow"("userId", "platform", "externalId");
CREATE INDEX "ExternalFollow_userId_idx" ON "ExternalFollow"("userId");
CREATE UNIQUE INDEX "ExternalPost_followId_externalId_key" ON "ExternalPost"("followId", "externalId");
CREATE INDEX "ExternalPost_publishedAt_idx" ON "ExternalPost"("publishedAt");

ALTER TABLE "ExternalFollow" ADD CONSTRAINT "ExternalFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalPost" ADD CONSTRAINT "ExternalPost_followId_fkey" FOREIGN KEY ("followId") REFERENCES "ExternalFollow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
