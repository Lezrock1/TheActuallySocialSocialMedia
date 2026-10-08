-- AlterTable
ALTER TABLE "NotificationPreference"
  ADD COLUMN "postsFromCircles" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "circles" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "meetupResponses" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quietStartMinute" INTEGER NOT NULL DEFAULT 1320,
  ADD COLUMN "quietEndMinute" INTEGER NOT NULL DEFAULT 420,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "quietDigestSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Circle" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Circle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleMember" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CircleMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meetup" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "place" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Meetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetupResponse" (
    "id" TEXT NOT NULL,
    "meetupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetupResponse_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "circleId" TEXT;
ALTER TABLE "Story"
  ADD COLUMN "circleId" TEXT,
  ADD COLUMN "audioKey" TEXT,
  ADD COLUMN "audioDurationMs" INTEGER;
ALTER TABLE "Message" ADD COLUMN "mediaKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Circle_ownerId_name_key" ON "Circle"("ownerId", "name");
CREATE UNIQUE INDEX "CircleMember_circleId_userId_key" ON "CircleMember"("circleId", "userId");
CREATE INDEX "CircleMember_userId_idx" ON "CircleMember"("userId");
CREATE UNIQUE INDEX "Meetup_storyId_key" ON "Meetup"("storyId");
CREATE UNIQUE INDEX "MeetupResponse_meetupId_userId_key" ON "MeetupResponse"("meetupId", "userId");
CREATE INDEX "MeetupResponse_userId_idx" ON "MeetupResponse"("userId");
CREATE INDEX "Message_mediaKey_idx" ON "Message"("mediaKey");
CREATE INDEX "Story_audioKey_idx" ON "Story"("audioKey");

-- AddForeignKey
ALTER TABLE "Circle" ADD CONSTRAINT "Circle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meetup" ADD CONSTRAINT "Meetup_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meetup" ADD CONSTRAINT "Meetup_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetupResponse" ADD CONSTRAINT "MeetupResponse_meetupId_fkey" FOREIGN KEY ("meetupId") REFERENCES "Meetup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetupResponse" ADD CONSTRAINT "MeetupResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
