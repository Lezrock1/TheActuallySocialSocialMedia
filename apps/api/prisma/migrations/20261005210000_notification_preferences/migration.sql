CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "postsFromFollowing" BOOLEAN NOT NULL DEFAULT true,
    "postsFromCloseFriends" BOOLEAN NOT NULL DEFAULT true,
    "snaps" BOOLEAN NOT NULL DEFAULT true,
    "messages" BOOLEAN NOT NULL DEFAULT true,
    "follows" BOOLEAN NOT NULL DEFAULT true,
    "comments" BOOLEAN NOT NULL DEFAULT true,
    "commentReplies" BOOLEAN NOT NULL DEFAULT true,
    "commentLikes" BOOLEAN NOT NULL DEFAULT true,
    "mentions" BOOLEAN NOT NULL DEFAULT true,
    "closeFriends" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;