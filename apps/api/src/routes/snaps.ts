import type { FastifyInstance } from "fastify";
import {
  createSnapSchema,
  encryptedSnapPayloadSchema,
  snapEncryptionKeysSchema,
} from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { deleteMediaIfUnreferenced } from "../storage.js";
import { ownsMedia } from "../mediaAccess.js";
import { isBlocked } from "../visibility.js";
import { createUserNotification } from "../notifications.js";
import { recordSnapInStreak } from "../snapStreak.js";

const SNAP_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function snapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/snaps/unread-count", { preHandler: requireAuth }, async (request, reply) => {
    const unreadCount = await prisma.snapRecipient.count({
      where: {
        userId: request.userId!,
        viewedAt: null,
        snap: { expiresAt: { gt: new Date() } },
      },
    });
    return reply.send({ unreadCount });
  });

  app.post("/snaps/encryption-keys", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = snapEncryptionKeysSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const recipients = await prisma.user.findMany({
      where: {
        username: { in: parsed.data.recipientUsernames },
        id: { not: request.userId! },
      },
      select: { id: true, username: true },
    });
    if (recipients.length !== new Set(parsed.data.recipientUsernames).size) {
      return reply.code(400).send({ error: "One or more recipients are invalid" });
    }
    const followed = await prisma.follow.count({
      where: {
        followerId: request.userId!,
        followeeId: { in: recipients.map((recipient) => recipient.id) },
      },
    });
    if (followed !== recipients.length) {
      return reply.code(403).send({ error: "Snaps can only be sent to followed accounts" });
    }
    if (
      await Promise.all(recipients.map((recipient) => isBlocked(request.userId!, recipient.id))).then(
        (blocked) => blocked.some(Boolean)
      )
    ) {
      return reply.code(403).send({ error: "A recipient is unavailable" });
    }

    const keys = await prisma.encryptionKey.findMany({
      where: { userId: { in: [request.userId!, ...recipients.map((recipient) => recipient.id)] } },
      select: { userId: true, fingerprint: true, publicKey: true },
    });
    return reply.send({ keys });
  });

  app.post("/snaps", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSnapSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (!(await ownsMedia(request.userId!, parsed.data.imageKey))) {
      return reply.code(403).send({ error: "You can only attach your own uploads" });
    }

    const recipients = await prisma.user.findMany({
      where: {
        username: { in: parsed.data.recipientUsernames },
        id: { not: request.userId! },
      },
      select: { id: true },
    });
    if (recipients.length === 0) {
      return reply.code(400).send({ error: "No valid recipients" });
    }
    if (
      await Promise.all(recipients.map((recipient) => isBlocked(request.userId!, recipient.id))).then(
        (blocked) => blocked.some(Boolean)
      )
    ) {
      return reply.code(403).send({ error: "A recipient is unavailable" });
    }

    if (parsed.data.encryptedPayload) {
      const expectedKeys = await prisma.encryptionKey.findMany({
        where: { userId: { in: [request.userId!, ...recipients.map((recipient) => recipient.id)] } },
        select: { userId: true, fingerprint: true },
      });
      const expectedUsers = new Set(expectedKeys.map((key) => key.userId));
      const missingUserIds = [request.userId!, ...recipients.map((recipient) => recipient.id)]
        .filter((userId) => !expectedUsers.has(userId));
      if (missingUserIds.length > 0) {
        return reply.code(409).send({ error: "Every participant must sign in once to enable Snap encryption" });
      }
      const missingFingerprints = expectedKeys.some(
        (key) => !parsed.data.encryptedPayload!.wrappedKeys[key.fingerprint]
      );
      if (missingFingerprints) {
        return reply.code(400).send({ error: "Snap is missing a recipient device key" });
      }
    }

    const sentAt = new Date();
    const snap = await prisma.$transaction(async (transaction) => {
      const createdSnap = await transaction.snap.create({
        data: {
          senderId: request.userId!,
          imageKey: parsed.data.imageKey,
          text: parsed.data.encryptedPayload
            ? JSON.stringify(parsed.data.encryptedPayload)
            : parsed.data.text,
          isEncrypted: !!parsed.data.encryptedPayload,
          createdAt: sentAt,
          expiresAt: new Date(sentAt.getTime() + SNAP_LIFETIME_MS),
          recipients: {
            create: recipients.map((recipient) => ({ userId: recipient.id })),
          },
        },
      });

      for (const recipient of recipients) {
        const [userAId, userBId] = [request.userId!, recipient.id].sort();
        const streak = await transaction.snapStreak.upsert({
          where: { userAId_userBId: { userAId, userBId } },
          create: { userAId, userBId },
          update: {},
        });
        await transaction.snapStreak.update({
          where: { id: streak.id },
          data: recordSnapInStreak(streak, request.userId === userAId, sentAt),
        });
      }

      return createdSnap;
    });
    await Promise.all(
      recipients.map((recipient) =>
        createUserNotification({
          recipientId: recipient.id,
          actorId: request.userId!,
          type: "snap",
          dedupeKey: `snap:${snap.id}:${recipient.id}`,
          snapId: snap.id,
        }).catch((error) => request.log.error(error, "Snap notification creation failed"))
      )
    );
    return reply.code(201).send({ snapId: snap.id });
  });

  app.get("/snaps/streaks", { preHandler: requireAuth }, async (request, reply) => {
    const streaks = await prisma.snapStreak.findMany({
      where: {
        OR: [{ userAId: request.userId! }, { userBId: request.userId! }],
      },
      include: { userA: true, userB: true },
      orderBy: [{ currentStreak: "desc" }, { bestStreak: "desc" }],
    });
    const now = Date.now();

    return reply.send({
      streaks: streaks.map((streak) => {
        const isUserA = streak.userAId === request.userId;
        const mySnapAt = isUserA ? streak.pendingUserAAt : streak.pendingUserBAt;
        const theirSnapAt = isUserA ? streak.pendingUserBAt : streak.pendingUserAAt;
        const isExpired = !streak.lastExchangeAt ||
          now - streak.lastExchangeAt.getTime() > 48 * 60 * 60 * 1000;
        const isPendingFresh = (sentAt: Date | null) =>
          !!sentAt && now - sentAt.getTime() <= 24 * 60 * 60 * 1000;
        return {
          friend: toPublicUser(isUserA ? streak.userB : streak.userA),
          currentStreak: isExpired ? 0 : streak.currentStreak,
          bestStreak: streak.bestStreak,
          lastExchangeAt: streak.lastExchangeAt?.toISOString() ?? null,
          waitingForYou: isPendingFresh(theirSnapAt) && !isPendingFresh(mySnapAt),
          waitingForThem: isPendingFresh(mySnapAt) && !isPendingFresh(theirSnapAt),
        };
      }),
    });
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
        text: r.snap.isEncrypted ? null : r.snap.text,
        isEncrypted: r.snap.isEncrypted,
        encryptedPayload: r.snap.isEncrypted && r.snap.text
          ? encryptedSnapPayloadSchema.parse(JSON.parse(r.snap.text))
          : null,
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
      const snap = await prisma.snap.findUnique({
        where: { id: request.params.id },
      });
      if (!snap || snap.expiresAt <= new Date()) {
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
          await prisma.snap.delete({ where: { id: snap.id } });
          await deleteMediaIfUnreferenced(snap.imageKey);
        }
      }
      return reply.code(204).send();
    }
  );
}
