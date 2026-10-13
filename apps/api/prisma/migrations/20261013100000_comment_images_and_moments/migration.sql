-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "imageKey" TEXT;

-- CreateTable
CREATE TABLE "Moment" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "Moment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MomentPost" (
    "id" TEXT NOT NULL,
    "momentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'image',
    "caption" TEXT,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MomentPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Moment_day_key" ON "Moment"("day");

-- CreateIndex
CREATE INDEX "MomentPost_userId_createdAt_idx" ON "MomentPost"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MomentPost_imageKey_idx" ON "MomentPost"("imageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MomentPost_momentId_userId_key" ON "MomentPost"("momentId", "userId");

-- CreateIndex
CREATE INDEX "Comment_imageKey_idx" ON "Comment"("imageKey");

-- AddForeignKey
ALTER TABLE "MomentPost" ADD CONSTRAINT "MomentPost_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentPost" ADD CONSTRAINT "MomentPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

