import type { FeedPost, PostVisibility } from "@app/shared";
import { toPublicUser } from "./serializers.js";

export const postWithCountsInclude = {
  author: true,
  _count: { select: { replies: true } },
} as const;

export function toFeedPost(post: {
  id: string;
  author: Parameters<typeof toPublicUser>[0];
  text: string | null;
  imageKey: string | null;
  createdAt: Date;
  visibility: string;
  parentPostId: string | null;
  factCheckCount: number;
  _count: { replies: number };
}): FeedPost {
  return {
    id: post.id,
    author: toPublicUser(post.author),
    text: post.text,
    imageKey: post.imageKey,
    createdAt: post.createdAt.toISOString(),
    visibility: post.visibility as PostVisibility,
    parentPostId: post.parentPostId,
    replyCount: post._count.replies,
    factCheckCount: post.factCheckCount,
  };
}
