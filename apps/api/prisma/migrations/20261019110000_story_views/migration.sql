CREATE TABLE "StoryView" (
  "storyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoryView_pkey" PRIMARY KEY ("storyId", "userId"),
  CONSTRAINT "StoryView_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StoryView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StoryView_userId_viewedAt_idx" ON "StoryView"("userId", "viewedAt");