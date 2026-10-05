import type { FeedPost, PostVisibility } from "@app/shared";
import { toPublicUser } from "./serializers.js";

export const postWithCountsInclude = {
  author: true,
  poll: { select: { id: true } },
  _count: { select: { replies: true, comments: true } },
} as const;

export function toFeedPost(post: {
  id: string;
  author: Parameters<typeof toPublicUser>[0];
  text: string | null;
  imageKey: string | null;
  createdAt: Date;
  visibility: string;
  parentPostId: string | null;
  poll: { id: string } | null;
  factCheckCount: number;
  _count: { replies: number; comments: number };
}): FeedPost {
  return {
    id: post.id,
    author: toPublicUser(post.author),
    text: post.text,
    imageKey: post.imageKey,
    createdAt: post.createdAt.toISOString(),
    visibility: post.visibility as PostVisibility,
    parentPostId: post.parentPostId,
    pollId: post.poll?.id ?? null,
    replyCount: post._count.replies,
    commentCount: post._count.comments,
    factCheckCount: post.factCheckCount,
  };
}
