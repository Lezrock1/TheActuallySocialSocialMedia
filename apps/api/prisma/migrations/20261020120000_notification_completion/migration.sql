ALTER TABLE "Notification"
  ADD COLUMN "storyId" TEXT,
  ADD COLUMN "reactionEmoji" TEXT,
  ADD COLUMN "dismissedAt" TIMESTAMP(3);

UPDATE "Notification" SET "dismissedAt" = "readAt" WHERE "readAt" IS NOT NULL;

CREATE INDEX "Notification_recipientId_dismissedAt_createdAt_idx"
  ON "Notification"("recipientId", "dismissedAt", "createdAt");