import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { COMMENT_REACTIONS, createCommentSchema } from "@app/shared";
import type { Comment, CommentReactionEmoji } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { createMentionNotifications, createUserNotification } from "../notifications.js";
import { canViewContent, canViewPostById, getBlockedUserIds } from "../visibility.js";
import { ownsMedia } from "../mediaAccess.js";
import { deleteMediaIfUnreferenced } from "../storage.js";

interface CommentRow {
  id: string;
  postId: string | null;
  repostId: string | null;
  authorId: string;
  parentCommentId: string | null;
  text: string;
  imageKey: string | null;
  createdAt: Date;
  author: User;
  _count: { likes: number; replies: number };
  likes: { userId: string; emoji: string }[];
}

function toComment(comment: CommentRow, viewerId: string): Comment {
  const reactionCounts = new Map<string, number>();
  for (const like of comment.likes) {
    reactionCounts.set(like.emoji, (reactionCounts.get(like.emoji) ?? 0) + 1);
  }
  const reactions = [...reactionCounts.entries()]
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => b.count - a.count);
  const myReaction = comment.likes.find((like) => like.userId === viewerId)?.emoji ?? null;
  return {
    id: comment.id,
    author: toPublicUser(comment.author),
    text: comment.text,
    imageKey: comment.imageKey,
    parentCommentId: comment.parentCommentId,
    replyCount: comment._count.replies,
    likeCount: comment._count.likes,
    likedByMe: myReaction !== null,
    reactions,
    myReaction,
    createdAt: comment.createdAt.toISOString(),
  };
}

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/posts/:id/comments",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await canViewPostById(request.userId!, request.params.id))) {
        return reply.code(404).send({ error: "Post not found" });
      }
      const comments = await prisma.comment.findMany({
        where: { postId: request.params.id, repostId: null },
        include: {
          author: true,
          _count: { select: { likes: true, replies: true } },
          likes: { select: { userId: true, emoji: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return reply.send({ comments: comments.map((comment) => toComment(comment, request.userId!)) });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/external/reposts/:id/comments",
    { preHandler: requireAuth },
    async (request, reply) => {
      const [repost, following, blocked] = await Promise.all([
        prisma.externalRepost.findUnique({ where: { id: request.params.id } }),
        prisma.follow.findMany({ where: { followerId: request.userId! }, select: { followeeId: true } }),
        getBlockedUserIds(request.userId!),
      ]);
      if (!repost || (repost.userId !== request.userId && (blocked.includes(repost.userId) || !following.some((f) => f.followeeId === repost.userId)))) {
        return reply.code(404).send({ error: "Repost not found" });
      }
      const comments = await prisma.comment.findMany({
        where: { repostId: repost.id },
        include: {
          author: true,
          _count: { select: { likes: true, replies: true } },
          likes: { select: { userId: true, emoji: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return reply.send({ comments: comments.map((comment) => toComment(comment, request.userId!)) });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/external/reposts/:id/comments",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = createCommentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const [repost, following, blocked] = await Promise.all([
        prisma.externalRepost.findUnique({ where: { id: request.params.id } }),
        prisma.follow.findMany({ where: { followerId: request.userId! }, select: { followeeId: true } }),
        getBlockedUserIds(request.userId!),
      ]);
      if (!repost || (repost.userId !== request.userId && (blocked.includes(repost.userId) || !following.some((f) => f.followeeId === repost.userId)))) {
        return reply.code(404).send({ error: "Repost not found" });
      }
      if (parsed.data.imageKey && !(await ownsMedia(request.userId!, parsed.data.imageKey))) {
        return reply.code(403).send({ error: "You can only attach your own uploads" });
      }
      let parentComment: { id: string; repostId: string | null; authorId: string; parentCommentId: string | null } | null = null;
      if (parsed.data.parentCommentId) {
        parentComment = await prisma.comment.findUnique({
          where: { id: parsed.data.parentCommentId },
          select: { id: true, repostId: true, authorId: true, parentCommentId: true },
        });
        if (!parentComment || parentComment.repostId !== repost.id) {
          return reply.code(404).send({ error: "Parent comment not found" });
        }
      }
      const comment = await prisma.comment.create({
        data: {
          repostId: repost.id,
          authorId: request.userId!,
          parentCommentId: parentComment?.id,
          text: parsed.data.text.trim(),
          imageKey: parsed.data.imageKey,
        },
        include: {
          author: true,
          _count: { select: { likes: true, replies: true } },
          likes: { select: { userId: true, emoji: true } },
        },
      });
      await prisma.externalRepost.update({ where: { id: repost.id }, data: { commentCount: { increment: 1 } } });
      const recipientId = parentComment?.authorId ?? repost.userId;
      const notificationType = parentComment ? "comment_reply" : "comment";
      try {
        await createUserNotification({
          recipientId,
          actorId: request.userId!,
          type: notificationType,
          dedupeKey: `${notificationType}:external:${comment.id}:${recipientId}`,
          commentId: comment.id,
        });
        await createMentionNotifications({
          text: comment.text,
          actorId: request.userId!,
          commentId: comment.id,
          excludedRecipientIds: [recipientId],
        });
      } catch (error) {
        request.log.error(error, "Repost comment notification creation failed");
      }
      return reply.code(201).send({ comment: toComment(comment, request.userId!) });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/posts/:id/comments",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = createCommentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const post = await prisma.post.findUnique({
        where: { id: request.params.id },
      });
      if (!post || !(await canViewContent(request.userId!, post))) {
        return reply.code(404).send({ error: "Post not found" });
      }
      if (parsed.data.imageKey && !(await ownsMedia(request.userId!, parsed.data.imageKey))) {
        return reply.code(403).send({ error: "You can only attach your own uploads" });
      }
      let parentComment: { id: string; postId: string | null; authorId: string; parentCommentId: string | null } | null = null;
      if (parsed.data.parentCommentId) {
        parentComment = await prisma.comment.findUnique({
          where: { id: parsed.data.parentCommentId },
          select: { id: true, postId: true, authorId: true, parentCommentId: true },
        });
        if (!parentComment || parentComment.postId !== post.id) {
          return reply.code(404).send({ error: "Parent comment not found" });
        }
      }

      const comment = await prisma.comment.create({
        data: {
          postId: post.id,
          repostId: null,
          authorId: request.userId!,
          parentCommentId: parentComment?.id,
          text: parsed.data.text.trim(),
          imageKey: parsed.data.imageKey,
        },
        include: {
          author: true,
          _count: { select: { likes: true, replies: true } },
          likes: { select: { userId: true, emoji: true } },
        },
      });
      const recipientId = parentComment?.authorId ?? post.authorId;
      const notificationType = parentComment ? "comment_reply" : "comment";
      try {
        await createUserNotification({
          recipientId,
          actorId: request.userId!,
          type: notificationType,
          dedupeKey: `${notificationType}:${comment.id}:${recipientId}`,
          postId: post.id,
          commentId: comment.id,
        });
        await createMentionNotifications({
          text: comment.text,
          actorId: request.userId!,
          postId: post.id,
          commentId: comment.id,
          excludedRecipientIds: [recipientId],
        });
      } catch (error) {
        request.log.error(error, "Comment notification creation failed");
      }
      return reply.code(201).send({ comment: toComment(comment, request.userId!) });
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/comments/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const comment = await prisma.comment.findUnique({
        where: { id: request.params.id },
      });
      if (!comment || comment.authorId !== request.userId) {
        return reply.code(404).send({ error: "Comment not found" });
      }
      await prisma.comment.delete({ where: { id: comment.id } });
      if (comment.imageKey) await deleteMediaIfUnreferenced(comment.imageKey);
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { emoji?: string } }>(
    "/comments/:id/like",
    { preHandler: requireAuth },
    async (request, reply) => {
      const emoji = request.body?.emoji ?? "❤️";
      if (!COMMENT_REACTIONS.includes(emoji as CommentReactionEmoji)) {
        return reply.code(400).send({ error: "Unsupported reaction emoji" });
      }
      const comment = await prisma.comment.findUnique({
        where: { id: request.params.id },
        select: { id: true, authorId: true, postId: true },
      });
      if (!comment) return reply.code(404).send({ error: "Comment not found" });
      if (!comment.postId || !(await canViewPostById(request.userId!, comment.postId))) {
        return reply.code(404).send({ error: "Comment not found" });
      }

      const existing = await prisma.commentLike.findUnique({
        where: {
          commentId_userId: {
            commentId: comment.id,
            userId: request.userId!,
          },
        },
      });
      // Switching the emoji updates the reaction in place without notifying again.
      if (existing) {
        if (existing.emoji !== emoji) {
          await prisma.commentLike.update({ where: { id: existing.id }, data: { emoji } });
        }
        return reply.code(204).send();
      }

      try {
        const like = await prisma.commentLike.create({
          data: { commentId: comment.id, userId: request.userId!, emoji },
        });
        await createUserNotification({
          recipientId: comment.authorId,
          actorId: request.userId!,
          type: "comment_like",
          dedupeKey: `comment-like:${like.id}`,
          postId: comment.postId ?? undefined,
          commentId: comment.id,
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) {
          return reply.code(204).send();
        }
        throw error;
      }
      return reply.code(204).send();
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/comments/:id/like",
    { preHandler: requireAuth },
    async (request, reply) => {
      await prisma.commentLike.deleteMany({
        where: { commentId: request.params.id, userId: request.userId! },
      });
      return reply.code(204).send();
    }
  );
}
