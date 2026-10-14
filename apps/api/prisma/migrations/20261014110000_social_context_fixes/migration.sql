ALTER TABLE "Message" ADD COLUMN "callId" TEXT;
CREATE UNIQUE INDEX "Message_callId_key" ON "Message"("callId");
ALTER TABLE "MusicNowPlaying" ADD COLUMN "links" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "MomentReaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "postId" TEXT NOT NULL REFERENCES "MomentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MomentReaction_postId_userId_key" ON "MomentReaction"("postId", "userId");