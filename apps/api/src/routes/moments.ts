import type { FastifyInstance } from "fastify";
import type { MomentFeed, MomentPostItem, MomentSummary } from "@app/shared";
import { createMomentPostSchema, MOMENT_WINDOW_SECONDS } from "@app/shared";
import type { Moment, MomentPost, User } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { ownsMedia } from "../mediaAccess.js";
import { deleteMediaIfUnreferenced } from "../storage.js";
import { getBlockedUserIds } from "../visibility.js";
import { ensureTodayMoment, utcDayKey } from "../moments.js";
import { z } from "zod";
import { createRateLimiter, rateLimitBy, byUser } from "../rateLimit.js";

const WINDOW_MS = MOMENT_WINDOW_SECONDS * 1000;
const reactionSchema = z.object({ emoji: z.enum(["❤️", "🔥", "😂", "😍", "👏", "😮"]).nullable() });
const reactionLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

type PostWithUser = MomentPost & { user: User; reactions?: { emoji: string; user: User }[] };

function toItem(post: PostWithUser, moment: Moment): MomentPostItem {
  const windowEnd = moment.startsAt.getTime() + WINDOW_MS;
  return {
    id: post.id,
    user: toPublicUser(post.user),
    imageKey: post.imageKey,
    mediaType: post.mediaType === "video" ? "video" : "image",
    caption: post.caption,
    late: post.late,
    lateBySeconds: post.late ? Math.max(0, Math.round((post.createdAt.getTime() - windowEnd) / 1000)) : 0,
    createdAt: post.createdAt.toISOString(),
    reactions: post.reactions?.map((reaction) => ({ emoji: reaction.emoji, user: toPublicUser(reaction.user) })) ?? [],
  };
}

function statusFor(moment: Moment | null, now: Date): MomentSummary["status"] {
  if (!moment) return "none";
  if (now < moment.startsAt) return "waiting";
  return now.getTime() <= moment.startsAt.getTime() + WINDOW_MS ? "open" : "late";
}

// Streaks count consecutive Moments you posted; today's still-open Moment doesn't break it yet.
async function computeStreaks(userId: string, now: Date): Promise<{ current: number; best: number }> {
  const moments = await prisma.moment.findMany({
    where: { startsAt: { lte: now } },
    orderBy: { startsAt: "desc" },
    take: 400,
    select: { id: true, day: true },
  });
  if (moments.length === 0) return { current: 0, best: 0 };
  const posts = await prisma.momentPost.findMany({
    where: { userId, momentId: { in: moments.map((moment) => moment.id) } },
    select: { momentId: true },
  });
  const posted = new Set(posts.map((post) => post.momentId));

  let index = moments[0].day === utcDayKey(now) && !posted.has(moments[0].id) ? 1 : 0;
  let current = 0;
  for (; index < moments.length && posted.has(moments[index].id); index += 1) current += 1;

  let best = 0;
  let run = 0;
  for (const moment of [...moments].reverse()) {
    run = posted.has(moment.id) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best: Math.max(best, current) };
}

async function friendIdsOf(userId: string): Promise<string[]> {
  const [follows, blocked] = await Promise.all([
    prisma.follow.findMany({
      where: { OR: [{ followerId: userId }, { followeeId: userId }] },
      select: { followerId: true, followeeId: true },
    }),
    getBlockedUserIds(userId),
  ]);
  const blockedSet = new Set(blocked);
  const ids = new Set<string>();
  for (const follow of follows) {
    const other = follow.followerId === userId ? follow.followeeId : follow.followerId;
    if (!blockedSet.has(other)) ids.add(other);
  }
  return [...ids];
}

export async function momentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { postId: string } }>("/moments/posts/:postId/reactions", { preHandler: requireAuth }, async (request, reply) => {
    const post = await prisma.momentPost.findUnique({ where: { id: request.params.postId }, include: { moment: true } });
    if (!post || post.moment.day !== utcDayKey(new Date()) || !(await canReadMoment(request.userId!, post))) {
      return reply.code(404).send({ error: "Moment unavailable" });
    }
    const blocked = await getBlockedUserIds(request.userId!);
    const reactions = await prisma.momentReaction.findMany({
      where: { postId: post.id, userId: { notIn: blocked } }, include: { user: true }, orderBy: { createdAt: "asc" },
    });
    return reply.send({ reactions: reactions.map((reaction) => ({ emoji: reaction.emoji, user: toPublicUser(reaction.user) })) });
  });
  app.post<{ Params: { postId: string } }>("/moments/posts/:postId/reactions", {
    preHandler: [requireAuth, rateLimitBy(reactionLimiter, byUser)],
  }, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Choose a valid reaction" });
    const post = await prisma.momentPost.findUnique({ where: { id: request.params.postId }, include: { moment: true } });
    if (!post || post.moment.day !== utcDayKey(new Date()) || !(await canReadMoment(request.userId!, post))) {
      return reply.code(404).send({ error: "Moment unavailable" });
    }
    if (parsed.data.emoji === null) await prisma.momentReaction.deleteMany({ where: { postId: post.id, userId: request.userId! } });
    else await prisma.momentReaction.upsert({
      where: { postId_userId: { postId: post.id, userId: request.userId! } },
      create: { postId: post.id, userId: request.userId!, emoji: parsed.data.emoji }, update: { emoji: parsed.data.emoji },
    });
    return reply.code(204).send();
  });
  app.get("/moments/today", { preHandler: requireAuth }, async (request, reply) => {
    const now = new Date();
    const moment = await ensureTodayMoment(now);
    const status = statusFor(moment, now);
    const [myPost, streaks] = await Promise.all([
      moment
        ? prisma.momentPost.findUnique({
          where: { momentId_userId: { momentId: moment.id, userId: request.userId! } },
          include: { user: true },
        })
        : null,
      computeStreaks(request.userId!, now),
    ]);
    // The exact time stays secret until it happens.
    const started = !!moment && now >= moment.startsAt;
    const summary: MomentSummary = {
      status,
      serverNow: now.toISOString(),
      startsAt: started ? moment!.startsAt.toISOString() : null,
      windowEndsAt: started ? new Date(moment!.startsAt.getTime() + WINDOW_MS).toISOString() : null,
      myPost: moment && myPost ? toItem(myPost, moment) : null,
      currentStreak: streaks.current,
      bestStreak: streaks.best,
    };
    return reply.send(summary);
  });

  app.post("/moments/today/post", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createMomentPostSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const now = new Date();
    const moment = await ensureTodayMoment(now);
    if (!moment || now < moment.startsAt) {
      return reply.code(409).send({ error: "Today's Moment hasn't started yet" });
    }
    if (!(await ownsMedia(request.userId!, parsed.data.imageKey))) {
      return reply.code(403).send({ error: "You can only attach your own uploads" });
    }
    const existing = await prisma.momentPost.findUnique({
      where: { momentId_userId: { momentId: moment.id, userId: request.userId! } },
      select: { id: true },
    });
    if (existing) return reply.code(409).send({ error: "You already shared today's Moment" });

    const late = now.getTime() > moment.startsAt.getTime() + WINDOW_MS;
    const post = await prisma.momentPost.create({
      data: {
        momentId: moment.id,
        userId: request.userId!,
        imageKey: parsed.data.imageKey,
        mediaType: parsed.data.mediaType,
        caption: parsed.data.caption || null,
        late,
      },
      include: { user: true },
    });
    return reply.code(201).send({ post: toItem(post, moment) });
  });

  app.delete("/moments/today/post", { preHandler: requireAuth }, async (request, reply) => {
    const moment = await prisma.moment.findUnique({ where: { day: utcDayKey(new Date()) } });
    if (!moment) return reply.code(204).send();
    const post = await prisma.momentPost.findUnique({
      where: { momentId_userId: { momentId: moment.id, userId: request.userId! } },
    });
    if (!post) return reply.code(204).send();
    await prisma.momentPost.delete({ where: { id: post.id } });
    await deleteMediaIfUnreferenced(post.imageKey);
    return reply.code(204).send();
  });

  app.get("/moments/today/feed", { preHandler: requireAuth }, async (request, reply) => {
    const now = new Date();
    const moment = await prisma.moment.findUnique({ where: { day: utcDayKey(now) } });
    if (!moment || now < moment.startsAt) {
      const empty: MomentFeed = { locked: false, friendPostCount: 0, posts: [] };
      return reply.send(empty);
    }
    const friendIds = await friendIdsOf(request.userId!);
    const [mine, friendPosts] = await Promise.all([
      prisma.momentPost.findUnique({
        where: { momentId_userId: { momentId: moment.id, userId: request.userId! } },
        include: { user: true },
      }),
      prisma.momentPost.findMany({
        where: { momentId: moment.id, userId: { in: friendIds } },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    // Post your own to see everyone else's.
    if (!mine) {
      const locked: MomentFeed = { locked: true, friendPostCount: friendPosts.length, posts: [] };
      return reply.send(locked);
    }
    const posts = [mine, ...friendPosts].map((post) => toItem(post, moment));
    const feed: MomentFeed = { locked: false, friendPostCount: friendPosts.length, posts };
    return reply.send(feed);
  });
}

async function canReadMoment(viewerId: string, post: MomentPost): Promise<boolean> {
  if (post.userId === viewerId) return true;
  const [mine, friends] = await Promise.all([
    prisma.momentPost.findUnique({ where: { momentId_userId: { momentId: post.momentId, userId: viewerId } }, select: { id: true } }),
    friendIdsOf(viewerId),
  ]);
  return !!mine && friends.includes(post.userId);
}
