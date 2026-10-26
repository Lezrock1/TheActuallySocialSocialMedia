-- Turn plain comment likes into emoji reactions.
ALTER TABLE "CommentLike" ADD COLUMN "emoji" TEXT NOT NULL DEFAULT '❤️';
