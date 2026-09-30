import type { FastifyInstance } from "fastify";
import { createSnapSchema } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { deleteMedia } from "../storage.js";

const SNAP_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function snapRoutes(app: FastifyInstance): Promise<void> {
  app.post("/snaps", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSnapSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const recipients = await prisma.user.findMany({
      where: { username: { in: parsed.data.recipientUsernames } },
      select: { id: true },
    });
    if (recipients.length === 0) {
      return reply.code(400).send({ error: "No valid recipients" });
    }

    const snap = await prisma.snap.create({
      data: {
        senderId: request.userId!,
        imageKey: parsed.data.imageKey,
        text: parsed.data.text,
        expiresAt: new Date(Date.now() + SNAP_LIFETIME_MS),
        recipients: {
          create: recipients.map((r) => ({ userId: r.id })),
        },
      },
    });
    return reply.code(201).send({ snapId: snap.id });
  });

  // Snaps sent to the current user that haven't been viewed or expired yet -
  // true view-once: once opened, a snap disappears from the inbox for good.
  app.get("/snaps/inbox", { preHandler: requireAuth }, async (request, reply) => {
    const recipientRows = await prisma.snapRecipient.findMany({
      where: {
        userId: request.userId!,
        viewedAt: null,
        snap: { expiresAt: { gt: new Date() } },
      },
      include: { snap: { include: { sender: true } } },
      orderBy: { snap: { createdAt: "desc" } },
    });

    return reply.send({
      snaps: recipientRows.map((r) => ({
        id: r.snap.id,
        sender: toPublicUser(r.snap.sender),
        imageKey: r.snap.imageKey,
        text: r.snap.text,
        createdAt: r.snap.createdAt.toISOString(),
        viewedAt: r.viewedAt?.toISOString() ?? null,
      })),
    });
  });

  app.post<{ Params: { id: string } }>(
    "/snaps/:id/view",
    { preHandler: requireAuth },
    async (request, reply) => {
      const recipient = await prisma.snapRecipient.findUnique({
        where: {
          snapId_userId: {
            snapId: request.params.id,
            userId: request.userId!,
          },
        },
      });
      if (!recipient) {
        return reply.code(404).send({ error: "Snap not found" });
      }
      if (!recipient.viewedAt) {
        await prisma.snapRecipient.update({
          where: { id: recipient.id },
          data: { viewedAt: new Date() },
        });

        const remainingUnviewed = await prisma.snapRecipient.count({
          where: { snapId: request.params.id, viewedAt: null },
        });
        if (remainingUnviewed === 0) {
          const snap = await prisma.snap.findUnique({
            where: { id: request.params.id },
          });
          if (snap) {
            await deleteMedia(snap.imageKey);
            await prisma.snap.delete({ where: { id: snap.id } });
          }
        }
      }
      return reply.code(204).send();
    }
  );
}
