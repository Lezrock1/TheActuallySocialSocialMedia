-- AlterTable
ALTER TABLE "Story" ADD COLUMN "videoKey" TEXT;

-- CreateIndex
CREATE INDEX "Story_videoKey_idx" ON "Story"("videoKey");
