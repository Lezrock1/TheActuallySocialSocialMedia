CREATE TABLE "MusicNowPlaying" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MusicNowPlaying_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicTaste" (
    "userId" TEXT NOT NULL,
    "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "favoriteTracks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MusicTaste_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "MusicMix" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" VARCHAR(500),
    "audioKey" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "waveform" JSONB NOT NULL,
    "tracklist" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MusicMix_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicMixComment" (
    "id" TEXT NOT NULL,
    "mixId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestampMs" INTEGER NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicMixComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MusicNowPlaying_userId_key" ON "MusicNowPlaying"("userId");
CREATE INDEX "MusicNowPlaying_updatedAt_idx" ON "MusicNowPlaying"("updatedAt");
CREATE UNIQUE INDEX "MusicMix_audioKey_key" ON "MusicMix"("audioKey");
CREATE INDEX "MusicMix_ownerId_createdAt_idx" ON "MusicMix"("ownerId", "createdAt");
CREATE INDEX "MusicMix_visibility_createdAt_idx" ON "MusicMix"("visibility", "createdAt");
CREATE INDEX "MusicMixComment_mixId_timestampMs_idx" ON "MusicMixComment"("mixId", "timestampMs");
CREATE INDEX "MusicMixComment_userId_createdAt_idx" ON "MusicMixComment"("userId", "createdAt");

ALTER TABLE "MusicNowPlaying" ADD CONSTRAINT "MusicNowPlaying_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicTaste" ADD CONSTRAINT "MusicTaste_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicMix" ADD CONSTRAINT "MusicMix_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicMixComment" ADD CONSTRAINT "MusicMixComment_mixId_fkey"
  FOREIGN KEY ("mixId") REFERENCES "MusicMix"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicMixComment" ADD CONSTRAINT "MusicMixComment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
