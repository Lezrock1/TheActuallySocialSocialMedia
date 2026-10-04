import type { FastifyInstance } from "fastify";
import type { NotificationsPage, UserNotification } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/notifications/unread-count",
    { preHandler: requireAuth },
    async (request, reply) => {
      const unreadCount = await prisma.notification.count({
        where: { recipientId: request.userId!, readAt: null },
      });
      return reply.send({ unreadCount });
    }
  );

  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/notifications",
    { preHandler: requireAuth },
    async (request, reply) => {
      const limit = Math.min(Math.max(Number(request.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const [rows, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where: { recipientId: request.userId! },
          include: { actor: true, comment: { select: { text: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(request.query.cursor
            ? { cursor: { id: request.query.cursor }, skip: 1 }
            : {}),
        }),
        prisma.notification.count({
          where: { recipientId: request.userId!, readAt: null },
        }),
      ]);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const notifications: UserNotification[] = page.map((row) => ({
        id: row.id,
        type: row.type as UserNotification["type"],
        actor: toPublicUser(row.actor),
        postId: row.postId,
        commentId: row.commentId,
        conversationId: row.conversationId,
        snapId: row.snapId,
        commentText: row.comment?.text ?? null,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      }));
      const response: NotificationsPage = {
        notifications,
        unreadCount,
        nextCursor: hasMore ? page[page.length - 1].id : null,
      };
      return reply.send(response);
    }
  );

  app.post(
    "/notifications/read-all",
    { preHandler: requireAuth },
    async (request, reply) => {
      const result = await prisma.notification.updateMany({
        where: { recipientId: request.userId!, readAt: null },
        data: { readAt: new Date() },
      });
      return reply.send({ updated: result.count });
    }
  );
}