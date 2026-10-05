import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { createCommentSchema } from "@app/shared";
import type { Comment } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { createMentionNotifications, createUserNotification } from "../notifications.js";

interface CommentRow {
  id: string;
  postId: string;
  authorId: string;
  parentCommentId: string | null;
  text: string;
  createdAt: Date;
  author: User;
  _count: { likes: number; replies: number };
  likes: { userId: string }[];
}

function toComment(comment: CommentRow): Comment {
  return {
    id: comment.id,
    author: toPublicUser(comment.author),
    text: comment.text,
    parentCommentId: comment.parentCommentId,
    replyCount: comment._count.replies,
    likeCount: comment._count.likes,
    likedByMe: comment.likes.length > 0,
    createdAt: comment.createdAt.toISOString(),
  };
}

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/posts/:id/comments",
    { preHandler: requireAuth },
    async (request, reply) => {
      const comments = await prisma.comment.findMany({
        where: { postId: request.params.id },
        include: {
          author: true,
          _count: { select: { likes: true, replies: true } },
          likes: {
            where: { userId: request.userId! },
            select: { userId: true },
          },
        },
        orderBy: { createdAt: "asc" },
      });
      return reply.send({ comments: comments.map(toComment) });
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
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }
      let parentComment: { id: string; postId: string; authorId: string; parentCommentId: string | null } | null = null;
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
          authorId: request.userId!,
          parentCommentId: parentComment?.id,
          text: parsed.data.text,
        },
        include: {
          author: true,
          _count: { select: { likes: true, replies: true } },
          likes: {
            where: { userId: request.userId! },
            select: { userId: true },
          },
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
      return reply.code(201).send({ comment: toComment(comment) });
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
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string } }>(
    "/comments/:id/like",
    { preHandler: requireAuth },
    async (request, reply) => {
      const comment = await prisma.comment.findUnique({
        where: { id: request.params.id },
        select: { id: true, authorId: true, postId: true },
      });
      if (!comment) return reply.code(404).send({ error: "Comment not found" });

      const existing = await prisma.commentLike.findUnique({
        where: {
          commentId_userId: {
            commentId: comment.id,
            userId: request.userId!,
          },
        },
      });
      if (existing) return reply.code(204).send();

      try {
        const like = await prisma.commentLike.create({
          data: { commentId: comment.id, userId: request.userId! },
        });
        await createUserNotification({
          recipientId: comment.authorId,
          actorId: request.userId!,
          type: "comment_like",
          dedupeKey: `comment-like:${like.id}`,
          postId: comment.postId,
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
