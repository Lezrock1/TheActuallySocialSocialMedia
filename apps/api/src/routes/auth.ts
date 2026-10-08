import type { FastifyInstance } from "fastify";
import argon2, { verifyAgainstDummy } from "../auth/passwords.js";
import {
  changePasswordSchema,
  checkUsernameSchema,
  deleteAccountSchema,
  loginSchema,
  registerSchema,
  updateAccountSchema,
} from "@app/shared";
import { prisma } from "../db.js";
import { signAuthToken } from "../auth/token.js";
import { AUTH_COOKIE_NAME, requireAuth } from "../auth/middleware.js";
import { env } from "../env.js";
import { toPublicUser } from "../serializers.js";
import { hashInvitationCode } from "../invitations.js";
import { purgeQueuedMediaDeletions } from "../storage.js";
import { byIp, byUser, createRateLimiter, rateLimitBy, sendRateLimited } from "../rateLimit.js";

const registerLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
const loginIpLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const loginAccountLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const accountActionLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10 });
const usernameCheckLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60 });
const accountActionGuard = rateLimitBy(accountActionLimiter, byUser);

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.nodeEnv === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

class InvalidInvitationError extends Error {}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", { preHandler: rateLimitBy(registerLimiter, byIp) }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, username, password, inviteCode } = parsed.data;
    const usernameCanonical = username.toLowerCase();

    // Cheap invitation check first, so callers without a valid invitation
    // cannot trigger the expensive password hash.
    const invitation = await prisma.invitation.findFirst({
      where: {
        tokenHash: hashInvitationCode(inviteCode),
        redeemedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!invitation) {
      return reply.code(400).send({ error: "Invitation code is invalid, expired, or already used" });
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: email.toLowerCase(), mode: "insensitive" } },
          { usernameCanonical },
        ],
      },
    });
    if (existing) {
      return reply.code(409).send({ error: "Email or username already taken" });
    }

    const passwordHash = await argon2.hash(password);
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        // Atomic claim: a link is closed once its last use is taken.
        const claim = await tx.$executeRaw`
          UPDATE "Invitation"
          SET "useCount" = "useCount" + 1,
              "redeemedAt" = CASE WHEN "useCount" + 1 >= "maxUses" THEN NOW() ELSE NULL END
          WHERE "tokenHash" = ${hashInvitationCode(inviteCode)}
            AND "redeemedAt" IS NULL
            AND "useCount" < "maxUses"
            AND "expiresAt" > NOW()`;
        if (claim !== 1) {
          throw new InvalidInvitationError();
        }
        return tx.user.create({ data: { email, username, usernameCanonical, passwordHash } });
      });
    } catch (error) {
      if (error instanceof InvalidInvitationError) {
        return reply.code(400).send({ error: "Invitation code is invalid, expired, or already used" });
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return reply.code(409).send({ error: "Email or username already taken" });
      }
      throw error;
    }

    const token = signAuthToken({ userId: user.id });
    reply.setCookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const accountKey = email.toLowerCase();

    const ipResult = loginIpLimiter.hit(request.ip);
    if (!ipResult.allowed) return sendRateLimited(reply, ipResult.retryAfterSeconds);
    const accountResult = loginAccountLimiter.hit(accountKey);
    if (!accountResult.allowed) return sendRateLimited(reply, accountResult.retryAfterSeconds);

    const user = await prisma.user.findFirst({
      where: { email: { equals: accountKey, mode: "insensitive" } },
    });
    if (!user) {
      await verifyAgainstDummy(password);
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    if (!(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    loginAccountLimiter.reset(accountKey);

    const token = signAuthToken({ userId: user.id });
    reply.setCookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
    return reply.send({ user: toPublicUser(user) });
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get(
    "/auth/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.userId },
      });
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }
      return reply.send({ user: toPublicUser(user) });
    }
  );

  app.get("/auth/account", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId! },
      select: { email: true, username: true },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return reply.send(user);
  });

  app.get<{ Querystring: { username?: string } }>(
    "/auth/username-availability",
    { preHandler: [requireAuth, rateLimitBy(usernameCheckLimiter, byUser)] },
    async (request, reply) => {
      const parsed = checkUsernameSchema.safeParse(request.query.username);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const existing = await prisma.user.findFirst({
        where: {
          usernameCanonical: parsed.data,
          id: { not: request.userId! },
        },
        select: { id: true },
      });
      return reply.send({ available: !existing });
    }
  );

  app.patch("/auth/account", { preHandler: [requireAuth, accountActionGuard] }, async (request, reply) => {
    const parsed = updateAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    if (!(await argon2.verify(user.passwordHash, parsed.data.currentPassword))) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }

    const usernameCanonical = parsed.data.username.toLowerCase();
    const usernameTaken = await prisma.user.findFirst({
      where: { usernameCanonical, id: { not: user.id } },
      select: { id: true },
    });
    if (usernameTaken) return reply.code(409).send({ error: "Username is already taken" });
    const emailTaken = await prisma.user.findFirst({
      where: { email: { equals: parsed.data.email, mode: "insensitive" }, id: { not: user.id } },
      select: { id: true },
    });
    if (emailTaken) return reply.code(409).send({ error: "Email is already taken" });

    try {
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          email: parsed.data.email,
          username: parsed.data.username,
          usernameCanonical,
        },
      });
      return reply.send({ user: toPublicUser(updated), email: updated.email });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Email or username is already taken" });
      }
      throw error;
    }
  });

  app.patch("/auth/password", { preHandler: [requireAuth, accountActionGuard] }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    if (!(await argon2.verify(user.passwordHash, parsed.data.currentPassword))) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return reply.code(400).send({ error: "New password must be different" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(parsed.data.newPassword) },
    });
    return reply.code(204).send();
  });

  app.delete("/auth/account", { preHandler: [requireAuth, accountActionGuard] }, async (request, reply) => {
    const parsed = deleteAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    if (!(await argon2.verify(user.passwordHash, parsed.data.currentPassword))) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }

    const [assets, posts, stories, sentSnaps, receivedSnaps, conversations, sharedFactChecks] = await Promise.all([
      prisma.mediaAsset.findMany({ where: { ownerId: user.id }, select: { key: true } }),
      prisma.post.findMany({ where: { authorId: user.id }, select: { imageKey: true } }),
      prisma.story.findMany({ where: { authorId: user.id }, select: { imageKey: true, audioKey: true } }),
      prisma.snap.findMany({ where: { senderId: user.id }, select: { imageKey: true } }),
      prisma.snapRecipient.findMany({
        where: { userId: user.id },
        select: {
          snap: {
            select: {
              id: true,
              imageKey: true,
              recipients: { select: { userId: true } },
            },
          },
        },
      }),
      prisma.conversation.findMany({
        where: { members: { some: { userId: user.id } } },
        select: { id: true, members: { select: { userId: true } } },
      }),
      prisma.aiConversation.findMany({
        where: { userId: user.id, shared: true },
        select: { postId: true },
      }),
    ]);

    const exclusivelyReceivedSnaps = receivedSnaps
      .filter(({ snap }) => snap.recipients.length === 1)
      .map(({ snap }) => snap);
    const directConversationIds = conversations
      .filter((conversation) => conversation.members.length <= 2)
      .map((conversation) => conversation.id);
    const voiceMessages = await prisma.message.findMany({
      where: {
        mediaKey: { not: null },
        OR: [{ senderId: user.id }, { conversationId: { in: directConversationIds } }],
      },
      select: { mediaKey: true },
    });
    const mediaKeys = [...new Set([
      user.avatarKey,
      ...assets.map((asset) => asset.key),
      ...posts.map((post) => post.imageKey),
      ...stories.flatMap((story) => [story.imageKey, story.audioKey]),
      ...sentSnaps.map((snap) => snap.imageKey),
      ...exclusivelyReceivedSnaps.map((snap) => snap.imageKey),
      ...voiceMessages.map((message) => message.mediaKey),
    ].filter((key): key is string => Boolean(key)))];
    const sharedFactCheckPostIds = [...new Set(sharedFactChecks.map((conversation) => conversation.postId))];

    await prisma.$transaction(async (transaction) => {
      if (mediaKeys.length) {
        await transaction.mediaDeletion.createMany({
          data: mediaKeys.map((key) => ({ key })),
          skipDuplicates: true,
        });
      }
      if (exclusivelyReceivedSnaps.length) {
        await transaction.snap.deleteMany({
          where: { id: { in: exclusivelyReceivedSnaps.map((snap) => snap.id) } },
        });
      }
      if (directConversationIds.length) {
        await transaction.conversation.deleteMany({ where: { id: { in: directConversationIds } } });
      }
      await transaction.report.deleteMany({
        where: { targetType: "user", targetId: { in: [user.id, user.username] } },
      });
      await transaction.user.delete({ where: { id: user.id } });

      for (const postId of sharedFactCheckPostIds) {
        const remainingSharedCount = await transaction.aiConversation.count({
          where: { postId, shared: true },
        });
        await transaction.post.updateMany({
          where: { id: postId },
          data: {
            factCheckCount: remainingSharedCount,
            ...(remainingSharedCount === 0 ? { factCheckSummary: null } : {}),
          },
        });
      }
    });

    try {
      await purgeQueuedMediaDeletions();
    } catch {
      request.log.error("Account media purge will be retried by the cleanup job");
    }
    reply.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
    return reply.code(204).send();
  });
}
