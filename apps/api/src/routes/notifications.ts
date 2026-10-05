import type { FastifyInstance } from "fastify";
import type { NotificationPreferences, NotificationsPage, UserNotification } from "@app/shared";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { env } from "../env.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "fcm.googleapis.com" ||
      url.hostname.endsWith(".push.services.mozilla.com") ||
      url.hostname.endsWith(".push.apple.com") ||
      url.hostname.endsWith(".notify.windows.com")
    );
  }, "Unsupported push endpoint"),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});
const pushEndpointSchema = z.object({ endpoint: pushSubscriptionSchema.shape.endpoint });
const notificationPreferencesSchema = z.object({
  postsFromFollowing: z.boolean().optional(),
  postsFromCloseFriends: z.boolean().optional(),
  snaps: z.boolean().optional(),
  messages: z.boolean().optional(),
  follows: z.boolean().optional(),
  comments: z.boolean().optional(),
  commentReplies: z.boolean().optional(),
  commentLikes: z.boolean().optional(),
  mentions: z.boolean().optional(),
  closeFriends: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose at least one setting");

function toNotificationPreferences(value: {
  postsFromFollowing: boolean;
  postsFromCloseFriends: boolean;
  snaps: boolean;
  messages: boolean;
  follows: boolean;
  comments: boolean;
  commentReplies: boolean;
  commentLikes: boolean;
  mentions: boolean;
  closeFriends: boolean;
}): NotificationPreferences {
  return {
    postsFromFollowing: value.postsFromFollowing,
    postsFromCloseFriends: value.postsFromCloseFriends,
    snaps: value.snaps,
    messages: value.messages,
    follows: value.follows,
    comments: value.comments,
    commentReplies: value.commentReplies,
    commentLikes: value.commentLikes,
    mentions: value.mentions,
    closeFriends: value.closeFriends,
  };
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications/preferences", { preHandler: requireAuth }, async (request, reply) => {
    const preferences = await prisma.notificationPreference.upsert({
      where: { userId: request.userId! },
      create: { userId: request.userId! },
      update: {},
    });
    return reply.send({ preferences: toNotificationPreferences(preferences) });
  });

  app.patch("/notifications/preferences", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = notificationPreferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const preferences = await prisma.notificationPreference.upsert({
      where: { userId: request.userId! },
      create: { userId: request.userId!, ...parsed.data },
      update: parsed.data,
    });
    return reply.send({ preferences: toNotificationPreferences(preferences) });
  });

  app.get("/notifications/push/config", { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({
      enabled: Boolean(env.webPushPublicKey && env.webPushPrivateKey),
      publicKey: env.webPushPublicKey ?? null,
    });
  });

  app.put("/notifications/push/subscription", { preHandler: requireAuth }, async (request, reply) => {
    if (!env.webPushPublicKey || !env.webPushPrivateKey) {
      return reply.code(503).send({ error: "Push notifications are not configured" });
    }
    const parsed = pushSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await prisma.webPushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      create: {
        userId: request.userId!,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
      update: {
        userId: request.userId!,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
    });
    return reply.code(204).send();
  });

  app.delete("/notifications/push/subscription", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = pushEndpointSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await prisma.webPushSubscription.deleteMany({
      where: { endpoint: parsed.data.endpoint, userId: request.userId! },
    });
    return reply.code(204).send();
  });

  app.get(
    "/notifications/unread-count",
    { preHandler: requireAuth },
    async (request, reply) => {
      const [unreadCount, messageUnreadCount] = await Promise.all([
        prisma.notification.count({
          where: { recipientId: request.userId!, readAt: null, type: { not: "message" } },
        }),
        prisma.notification.count({
          where: { recipientId: request.userId!, readAt: null, type: "message" },
        }),
      ]);
      return reply.send({ unreadCount, messageUnreadCount });
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