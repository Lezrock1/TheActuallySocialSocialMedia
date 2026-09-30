import type { FastifyInstance } from "fastify";
import { createCommentSchema } from "@app/shared";
import type { Comment } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/posts/:id/comments",
    { preHandler: requireAuth },
    async (request, reply) => {
      const comments = await prisma.comment.findMany({
        where: { postId: request.params.id },
        include: { author: true },
        orderBy: { createdAt: "asc" },
      });
      const dtos: Comment[] = comments.map((c) => ({
        id: c.id,
        author: toPublicUser(c.author),
        text: c.text,
        createdAt: c.createdAt.toISOString(),
      }));
      return reply.send({ comments: dtos });
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
      const comment = await prisma.comment.create({
        data: {
          postId: post.id,
          authorId: request.userId!,
          text: parsed.data.text,
        },
        include: { author: true },
      });
      const dto: Comment = {
        id: comment.id,
        author: toPublicUser(comment.author),
        text: comment.text,
        createdAt: comment.createdAt.toISOString(),
      };
      return reply.code(201).send({ comment: dto });
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
}
