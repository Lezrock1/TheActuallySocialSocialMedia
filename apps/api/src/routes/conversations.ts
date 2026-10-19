import type { FastifyInstance } from "fastify";
import { createHash, createPublicKey } from "node:crypto";
import {
  createGroupConversationSchema,
  encryptedMessagePayloadSchema,
  sendMessageSchema,
  startConversationSchema,
} from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { completeUserNotifications, createUserNotification } from "../notifications.js";
import { emitToUsers } from "../realtime.js";
import { isBlocked, canViewContent } from "../visibility.js";
import { ownsMedia } from "../mediaAccess.js";

const DEFAULT_MESSAGES_LIMIT = 40;
const MAX_MESSAGES_LIMIT = 100;

function messageIdFromDedupeKey(dedupeKey: string): string | null {
  if (!dedupeKey.startsWith("message:")) return null;
  const parts = dedupeKey.split(":");
  return parts.length >= 3 ? parts[1] : null;
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/conversations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = startConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const other = await prisma.user.findUnique({
        where: { username: parsed.data.username },
      });
      if (!other || other.id === request.userId) {
        return reply.code(400).send({ error: "Invalid recipient" });
      }
      if (await isBlocked(request.userId!, other.id)) {
        return reply.code(403).send({ error: "Not available" });
      }

      const existing = await prisma.conversation.findFirst({
        where: {
          name: null,
          members: {
            every: { userId: { in: [request.userId!, other.id] } },
          },
          AND: [
            { members: { some: { userId: request.userId! } } },
            { members: { some: { userId: other.id } } },
          ],
        },
      });
      if (existing) {
        return reply.send({ conversationId: existing.id });
      }

      const conversation = await prisma.conversation.create({
        data: {
          members: {
            create: [{ userId: request.userId! }, { userId: other.id }],
          },
        },
      });
      return reply.code(201).send({ conversationId: conversation.id });
    }
  );

  // Group chat: 3+ members (or 2, with an optional name). NOTE: messages are
  // stored as plaintext server-side - no end-to-end encryption yet, see README.
  app.post(
    "/conversations/group",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = createGroupConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const otherUsers = await prisma.user.findMany({
        where: { username: { in: parsed.data.usernames } },
        select: { id: true },
      });
      const memberIds = [
        request.userId!,
        ...otherUsers.map((u) => u.id).filter((id) => id !== request.userId),
      ];
      if (memberIds.length < 2 && !parsed.data.allowEmpty) {
        return reply.code(400).send({ error: "Need at least one other member" });
      }

      const conversation = await prisma.conversation.create({
        data: {
          name: parsed.data.name,
          members: { create: memberIds.map((userId) => ({ userId })) },
        },
      });
      return reply.code(201).send({ conversationId: conversation.id });
    }
  );

  app.get("/conversations", { preHandler: requireAuth }, async (request, reply) => {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId: request.userId! },
      include: {
        conversation: {
          include: {
            members: { include: { user: true } },
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });
    const unreadMessages = memberships.length
      ? await prisma.notification.groupBy({
          by: ["conversationId"],
          where: {
            recipientId: request.userId!,
            type: "message",
            conversationId: { in: memberships.map((membership) => membership.conversationId) },
            readAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const unreadCountByConversation = new Map<string, number>();
    for (const unread of unreadMessages) {
      if (unread.conversationId) {
        unreadCountByConversation.set(unread.conversationId, unread._count._all);
      }
    }

    const summaries = memberships.flatMap((m) => {
      if (m.conversation.members.length === 1 && m.conversation.messages.length === 0) return [];
      const isGroup = m.conversation.members.length > 2 || !!m.conversation.name;
      const otherMember = m.conversation.members.find(
        (mem) => mem.userId !== request.userId
      );
      const last = m.conversation.messages[0];
      return [{
        id: m.conversation.id,
        name: m.conversation.name,
        isGroup,
        members: m.conversation.members.map((mem) => toPublicUser(mem.user)),
        otherMember: !isGroup && otherMember ? toPublicUser(otherMember.user) : null,
        unreadCount: unreadCountByConversation.get(m.conversation.id) ?? 0,
        lastMessage: last
          ? {
              text: last.isEncrypted ? null : last.text,
              isEncrypted: last.isEncrypted,
              createdAt: last.createdAt.toISOString(),
              senderId: last.senderId,
            }
          : null,
      }];
    });
    summaries.sort((a, b) => {
      if (!a.lastMessage) return b.lastMessage ? 1 : 0;
      if (!b.lastMessage) return -1;
      return Date.parse(b.lastMessage.createdAt) - Date.parse(a.lastMessage.createdAt);
    });
    return reply.send({ conversations: summaries });
  });

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>(
    "/conversations/:id/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const membership = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: request.params.id,
            userId: request.userId!,
          },
        },
      });
      if (!membership) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const limit = Math.min(
        Math.max(Number(request.query.limit) || DEFAULT_MESSAGES_LIMIT, 1),
        MAX_MESSAGES_LIMIT
      );
      const rows = await prisma.message.findMany({
        where: { conversationId: request.params.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(request.query.cursor
          ? { cursor: { id: request.query.cursor }, skip: 1 }
          : {}),
      });

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null;
      const messages = [...pageRows].reverse();

      const memberIds = await prisma.conversationMember.findMany({
        where: { conversationId: request.params.id },
        select: { userId: true },
      });
      const messageIds = messages.map((message) => message.id);
      const receipts = messageIds.length
        ? await prisma.notification.findMany({
            where: {
              conversationId: request.params.id,
              type: "message",
              OR: messageIds.map((id) => ({ dedupeKey: { startsWith: `message:${id}:` } })),
            },
            select: { dedupeKey: true, readAt: true },
          })
        : [];
      const receiptByMessage = new Map<string, { delivered: number; read: number }>();
      for (const receipt of receipts) {
        const messageId = messageIdFromDedupeKey(receipt.dedupeKey);
        if (!messageId) continue;
        const state = receiptByMessage.get(messageId) ?? { delivered: 0, read: 0 };
        state.delivered += 1;
        if (receipt.readAt) state.read += 1;
        receiptByMessage.set(messageId, state);
      }

      return reply.send({
        messages: messages.map((m) => ({
          id: m.id,
          callId: m.callId,
          senderId: m.senderId,
          text: m.isEncrypted ? null : m.text,
          isEncrypted: m.isEncrypted,
          encryptedPayload: m.isEncrypted
            ? encryptedMessagePayloadSchema.parse(JSON.parse(m.text))
            : null,
          createdAt: m.createdAt.toISOString(),
          mediaKey: m.mediaKey,
          deliveryState: (() => {
            const recipientCount = memberIds.filter((member) => member.userId !== m.senderId).length;
            if (recipientCount <= 0) return "sent" as const;
            const receipt = receiptByMessage.get(m.id);
            if (receipt?.read === recipientCount) return "read" as const;
            if (receipt?.delivered === recipientCount) return "delivered" as const;
            return "sent" as const;
          })(),
        })),
        nextCursor,
      });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/conversations/:id/read",
    { preHandler: requireAuth },
    async (request, reply) => {
      const membership = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: request.params.id,
            userId: request.userId!,
          },
        },
      });
      if (!membership) {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      const read = await completeUserNotifications(request.server.io, request.userId!, { conversationId: request.params.id, type: "message" });
      if (read > 0) {
        const members = await prisma.conversationMember.findMany({ where: { conversationId: request.params.id }, select: { userId: true } });
        emitToUsers(request.server.io, members.map((member) => member.userId), "message:updated", { conversationId: request.params.id });
      }
      return reply.code(204).send();
    }
  );

  app.get<{ Params: { id: string } }>(
    "/conversations/:id/encryption-keys",
    { preHandler: requireAuth },
    async (request, reply) => {
      const membership = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: request.params.id,
            userId: request.userId!,
          },
        },
      });
      if (!membership) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const keys = await prisma.encryptionKey.findMany({
        where: { user: { conversations: { some: { conversationId: request.params.id } } } },
        select: { userId: true, fingerprint: true, publicKey: true },
      });
      return reply.send({ keys });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/conversations/:id/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = sendMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const membership = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: request.params.id,
            userId: request.userId!,
          },
        },
      });
      if (!membership) {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      const encryptedPayload = "encryptedPayload" in parsed.data
        ? parsed.data.encryptedPayload
        : null;
      const plainText = "text" in parsed.data ? parsed.data.text : null;
      const storyId = "storyId" in parsed.data ? parsed.data.storyId : undefined;
      let mediaKey = parsed.data.mediaKey ?? null;
      if (mediaKey && !encryptedPayload) {
        return reply.code(400).send({ error: "Voice-message attachments must be end-to-end encrypted" });
      }
      if (mediaKey && !(await ownsMedia(request.userId!, mediaKey))) {
        return reply.code(403).send({ error: "You can only attach your own uploads" });
      }
      if (storyId) {
        const story = await prisma.story.findUnique({ where: { id: storyId } });
        if (!story || story.expiresAt <= new Date() || !(await canViewContent(request.userId!, story))) {
          return reply.code(404).send({ error: "Story is no longer available" });
        }
        mediaKey = story.imageKey;
      }
      const isEncrypted = encryptedPayload !== null;
      const storedText = encryptedPayload ? JSON.stringify(encryptedPayload) : plainText!;
      const message = await prisma.message.create({
        data: {
          conversationId: request.params.id,
          senderId: request.userId!,
          text: storedText,
          isEncrypted,
          mediaKey,
        },
      });
      const messageDto = {
        id: message.id,
        senderId: message.senderId,
        text: isEncrypted ? null : message.text,
        isEncrypted,
        encryptedPayload,
        createdAt: message.createdAt.toISOString(),
        mediaKey,
        deliveryState: "sent" as const,
      };

      const members = await prisma.conversationMember.findMany({
        where: { conversationId: request.params.id },
        select: { userId: true },
      });
      await Promise.all(
        members
          .filter((member) => member.userId !== request.userId)
          .map((member) =>
            createUserNotification({
              recipientId: member.userId,
              actorId: request.userId!,
              type: "message",
              dedupeKey: `message:${message.id}:${member.userId}`,
              conversationId: request.params.id,
            }).catch((error) => request.log.error(error, "Message notification creation failed"))
          )
      );
      emitToUsers(
        request.server.io,
        members.map((m) => m.userId),
        "message:new",
        { conversationId: request.params.id, message: messageDto }
      );

      return reply.code(201).send({ message: messageDto });
    }
  );
}
