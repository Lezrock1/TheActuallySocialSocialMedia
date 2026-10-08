import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { z } from "zod";
import argon2 from "../auth/passwords.js";
import { requireAuth } from "../auth/middleware.js";
import { signExportToken, verifyExportToken } from "../auth/token.js";
import { prisma } from "../db.js";
import { getMedia } from "../storage.js";
import { env } from "../env.js";
import { byUser, createRateLimiter, rateLimitBy, sendRateLimited } from "../rateLimit.js";

const exportTokenLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const MAX_CONCURRENT_EXPORTS = 2;
const activeExportUsers = new Set<string>();
const consumedExportTokens = new Map<string, number>();

const exportRequestSchema = z.object({ currentPassword: z.string().min(1).max(200) });

const EXPORT_README = `InTouch data export

Everything in this archive belongs to your account.
- data/*.json contains your profile, posts, comments, stories, circles and settings.
- messages.json holds the messages you sent. End-to-end encrypted messages are exported as ciphertext
  because only your devices hold the keys to read them.
- media/ contains the files you uploaded that still exist on the server.
Secrets (password hash, AI API keys, push subscriptions) are never exported.
`;

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

async function collectExport(userId: string) {
  const [
    user, posts, comments, commentLikes, stories, storyReactions, snaps, conversations, messages,
    following, followers, closeFriends, circles, blocks, notifications, preferences,
    reports, aiProviders, aiConversations, encryptionKeys, invitations, pollVotes,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, username: true, displayName: true, bio: true,
        avatarKey: true, translationLanguage: true, createdAt: true,
      },
    }),
    prisma.post.findMany({
      where: { authorId: userId },
      include: { poll: { include: { options: true } }, circle: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.comment.findMany({ where: { authorId: userId }, orderBy: { createdAt: "asc" } }),
    prisma.commentLike.findMany({ where: { userId }, select: { commentId: true, createdAt: true } }),
    prisma.story.findMany({
      where: { authorId: userId },
      include: { meetup: true, circle: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.storyReaction.findMany({ where: { userId }, select: { storyId: true, emoji: true, createdAt: true } }),
    prisma.snap.findMany({
      where: { senderId: userId },
      include: { recipients: { include: { user: { select: { username: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: { members: { include: { user: { select: { username: true } } } } },
    }),
    prisma.message.findMany({
      where: { conversation: { members: { some: { userId } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.follow.findMany({ where: { followerId: userId }, include: { followee: { select: { username: true } } } }),
    prisma.follow.findMany({ where: { followeeId: userId }, include: { follower: { select: { username: true } } } }),
    prisma.closeFriend.findMany({ where: { ownerId: userId }, include: { friend: { select: { username: true } } } }),
    prisma.circle.findMany({
      where: { ownerId: userId },
      include: { members: { include: { user: { select: { username: true } } } } },
    }),
    prisma.blockedUser.findMany({ where: { blockerId: userId }, include: { blocked: { select: { username: true } } } }),
    prisma.notification.findMany({
      where: { recipientId: userId },
      include: { actor: { select: { username: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.report.findMany({ where: { reporterId: userId } }),
    prisma.aiProviderConfig.findMany({
      where: { userId },
      select: { id: true, label: true, type: true, baseUrl: true, model: true, isDefault: true, createdAt: true },
    }),
    prisma.aiConversation.findMany({ where: { userId }, include: { messages: true } }),
    prisma.encryptionKey.findMany({ where: { userId }, select: { fingerprint: true, publicKey: true, createdAt: true } }),
    prisma.invitation.findMany({
      where: { inviterId: userId },
      select: { createdAt: true, expiresAt: true, maxUses: true, useCount: true },
    }),
    prisma.pollVote.findMany({ where: { userId }, select: { pollId: true, optionId: true, createdAt: true } }),
  ]);

  return {
    "profile.json": user,
    "posts.json": posts.map((post) => ({
      id: post.id, text: post.text, imageKey: post.imageKey, mediaType: post.mediaType,
      visibility: post.visibility, circle: post.circle?.name ?? null, parentPostId: post.parentPostId,
      createdAt: iso(post.createdAt),
      poll: post.poll
        ? { question: post.poll.question, options: post.poll.options.map((option) => option.text) }
        : null,
    })),
    "comments.json": { written: comments, liked: commentLikes },
    "stories.json": {
      active: stories.map((story) => ({
        id: story.id, imageKey: story.imageKey, audioKey: story.audioKey, text: story.text,
        visibility: story.visibility, circle: story.circle?.name ?? null,
        createdAt: iso(story.createdAt), expiresAt: iso(story.expiresAt),
        meetup: story.meetup
          ? { title: story.meetup.title, startsAt: iso(story.meetup.startsAt), place: story.meetup.place }
          : null,
      })),
      reactionsGiven: storyReactions,
    },
    "snaps.json": snaps.map((snap) => ({
      id: snap.id, imageKey: snap.imageKey, text: snap.text, isEncrypted: snap.isEncrypted,
      createdAt: iso(snap.createdAt), expiresAt: iso(snap.expiresAt),
      recipients: snap.recipients.map((recipient) => recipient.user.username),
    })),
    "messages.json": messages.map((message) => ({
      id: message.id, conversationId: message.conversationId, isEncrypted: message.isEncrypted,
      text: message.text, mediaKey: message.mediaKey, createdAt: iso(message.createdAt),
    })),
    "conversations.json": conversations.map((conversation) => ({
      id: conversation.id,
      name: conversation.name,
      members: conversation.members.map((member) => member.user.username),
      createdAt: iso(conversation.createdAt),
    })),
    "connections.json": {
      following: following.map((row) => ({ username: row.followee.username, since: iso(row.createdAt) })),
      followers: followers.map((row) => ({ username: row.follower.username, since: iso(row.createdAt) })),
      closeFriends: closeFriends.map((row) => row.friend.username),
      blocked: blocks.map((row) => row.blocked.username),
    },
    "circles.json": circles.map((circle) => ({
      name: circle.name,
      createdAt: iso(circle.createdAt),
      members: circle.members.map((member) => member.user.username),
    })),
    "notifications.json": {
      preferences,
      received: notifications.map((notification) => ({
        type: notification.type, from: notification.actor.username,
        createdAt: iso(notification.createdAt), readAt: iso(notification.readAt),
      })),
    },
    "ai.json": { providers: aiProviders, conversations: aiConversations },
    "security.json": { encryptionKeys, invitationsCreated: invitations, reportsFiled: reports, pollVotes },
  };
}

export async function accountExportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/auth/account/export-token",
    { preHandler: [requireAuth, rateLimitBy(exportTokenLimiter, byUser)] },
    async (request, reply) => {
      const parsed = exportRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const user = await prisma.user.findUnique({
        where: { id: request.userId! },
        select: { id: true, passwordHash: true },
      });
      if (!user) return reply.code(404).send({ error: "User not found" });
      if (!(await argon2.verify(user.passwordHash, parsed.data.currentPassword))) {
        return reply.code(401).send({ error: "Current password is incorrect" });
      }
      reply.setCookie("account_export", signExportToken(user.id), {
        httpOnly: true,
        secure: env.nodeEnv === "production",
        sameSite: "strict",
        path: "/auth/account/export",
        maxAge: 60,
      });
      return reply.code(204).send();
    }
  );

  app.get("/auth/account/export", async (request, reply) => {
    const token = request.cookies.account_export;
    const userId = token ? verifyExportToken(token) : null;
    if (!userId || (token && consumedExportTokens.has(token))) {
      reply.clearCookie("account_export", { path: "/auth/account/export" });
      return reply.code(401).send({ error: "Download link expired. Start the export again." });
    }
    if (token) {
      const now = Date.now();
      if (consumedExportTokens.size > 5000) {
        for (const [value, expiry] of consumedExportTokens) {
          if (expiry <= now) consumedExportTokens.delete(value);
        }
      }
      consumedExportTokens.set(token, now + 60_000);
    }
    reply.clearCookie("account_export", { path: "/auth/account/export" });
    if (activeExportUsers.has(userId) || activeExportUsers.size >= MAX_CONCURRENT_EXPORTS) {
      return sendRateLimited(reply, 30);
    }
    activeExportUsers.add(userId);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const release = () => activeExportUsers.delete(userId);
    archive.on("end", release);
    archive.on("error", (error: Error) => {
      request.log.error(error, "Account export failed");
      release();
    });
    reply.raw.on("close", release);

    void (async () => {
      try {
        archive.append(EXPORT_README, { name: "README.txt" });
        const files = await collectExport(userId);
        for (const [name, content] of Object.entries(files)) {
          archive.append(JSON.stringify(content, null, 2), { name: `data/${name}` });
        }
        const assets = await prisma.mediaAsset.findMany({ where: { ownerId: userId }, select: { key: true } });
        for (const { key } of assets) {
          const media = await getMedia(key);
          if (!media) continue;
          const entryDone = new Promise<void>((resolve) => archive.once("entry", () => resolve()));
          archive.append(media.body as unknown as Readable, { name: `media/${key}` });
          await entryDone;
        }
        await archive.finalize();
      } catch (error) {
        request.log.error(error, "Account export failed");
        archive.abort();
        release();
      }
    })();

    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="intouch-export-${stamp}.zip"`)
      .header("Cache-Control", "no-store")
      .send(archive);
  });
}
