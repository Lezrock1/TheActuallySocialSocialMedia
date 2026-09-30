import type { FastifyInstance } from "fastify";
import {
  createGroupConversationSchema,
  sendMessageSchema,
  startConversationSchema,
} from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { emitToUsers } from "../realtime.js";
import { isBlocked } from "../visibility.js";

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
      if (memberIds.length < 2) {
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

    const summaries = memberships.map((m) => {
      const isGroup = m.conversation.members.length > 2 || !!m.conversation.name;
      const otherMember = m.conversation.members.find(
        (mem) => mem.userId !== request.userId
      );
      const last = m.conversation.messages[0];
      return {
        id: m.conversation.id,
        name: m.conversation.name,
        isGroup,
        members: m.conversation.members.map((mem) => toPublicUser(mem.user)),
        otherMember: !isGroup && otherMember ? toPublicUser(otherMember.user) : null,
        lastMessage: last
          ? {
              text: last.text,
              createdAt: last.createdAt.toISOString(),
              senderId: last.senderId,
            }
          : null,
      };
    });
    return reply.send({ conversations: summaries });
  });

  app.get<{ Params: { id: string } }>(
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
      const messages = await prisma.message.findMany({
        where: { conversationId: request.params.id },
        orderBy: { createdAt: "asc" },
      });
      return reply.send({
        messages: messages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          text: m.text,
          createdAt: m.createdAt.toISOString(),
        })),
      });
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
      const message = await prisma.message.create({
        data: {
          conversationId: request.params.id,
          senderId: request.userId!,
          text: parsed.data.text,
        },
      });
      const messageDto = {
        id: message.id,
        senderId: message.senderId,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
      };

      const members = await prisma.conversationMember.findMany({
        where: { conversationId: request.params.id },
        select: { userId: true },
      });
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
