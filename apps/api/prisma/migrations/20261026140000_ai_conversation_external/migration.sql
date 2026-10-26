-- AI conversations can now reference external posts (Bluesky/Mastodon/YouTube)
-- instead of an internal post.
ALTER TABLE "AiConversation" ALTER COLUMN "postId" DROP NOT NULL;
ALTER TABLE "AiConversation" ADD COLUMN "externalLabel" TEXT;
