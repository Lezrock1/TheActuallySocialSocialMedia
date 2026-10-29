ALTER TABLE "ExternalRepost" ADD COLUMN "commentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Comment" ALTER COLUMN "postId" DROP NOT NULL;
ALTER TABLE "Comment" ADD COLUMN "repostId" TEXT;

CREATE INDEX "ExternalRepost_platform_externalId_idx" ON "ExternalRepost"("platform", "externalId");
CREATE INDEX "Comment_repostId_createdAt_idx" ON "Comment"("repostId", "createdAt");

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_repostId_fkey" FOREIGN KEY ("repostId") REFERENCES "ExternalRepost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
