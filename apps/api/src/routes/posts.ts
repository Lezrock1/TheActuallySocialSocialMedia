import type { FastifyInstance } from "fastify";
import { createPostSchema } from "@app/shared";
import type { FeedPage } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { deleteMediaIfUnreferenced } from "../storage.js";
import { ownsMedia } from "../mediaAccess.js";
import { getBlockedUserIds, getCloseFriendGrantedAuthorIds } from "../visibility.js";
import { postWithCountsInclude, toFeedPost } from "../postSerializer.js";

const DEFAULT_LIMIT = 20;

export async function postRoutes(app: FastifyInstance): Promise<void> {
  app.post("/posts", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createPostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (!parsed.data.text && !parsed.data.imageKey) {
      return reply.code(400).send({ error: "Post needs text or an image" });
    }
    if (
      parsed.data.imageKey &&
      !(await ownsMedia(request.userId!, parsed.data.imageKey))
    ) {
      return reply.code(403).send({ error: "You can only attach your own uploads" });
    }
    if (parsed.data.parentPostId) {
      const parent = await prisma.post.findUnique({
        where: { id: parsed.data.parentPostId },
      });
      if (!parent) {
        return reply.code(404).send({ error: "Parent post not found" });
      }
    }

    const post = await prisma.post.create({
      data: {
        authorId: request.userId!,
        text: parsed.data.text,
        imageKey: parsed.data.imageKey,
        parentPostId: parsed.data.parentPostId,
        visibility: parsed.data.visibility ?? "public",
      },
      include: postWithCountsInclude,
    });

    return reply.code(201).send({ post: toFeedPost(post) });
  });

  app.delete<{ Params: { id: string } }>(
    "/posts/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const post = await prisma.post.findUnique({
        where: { id: request.params.id },
      });
      if (!post || post.authorId !== request.userId) {
        return reply.code(404).send({ error: "Post not found" });
      }
      // hard delete: remove the DB row (cascades replies/comments) AND the
      // underlying image, nothing kept around
      await prisma.post.delete({ where: { id: post.id } });
      if (post.imageKey) {
        await deleteMediaIfUnreferenced(post.imageKey);
      }
      return reply.code(204).send();
    }
  );

  // A post plus its immediate parent (if it's a reply) and its direct
  // replies in chronological order - a Twitter-style thread view.
  app.get<{ Params: { id: string } }>(
    "/posts/:id/thread",
    { preHandler: requireAuth },
    async (request, reply) => {
      const post = await prisma.post.findUnique({
        where: { id: request.params.id },
        include: postWithCountsInclude,
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }
      const [parent, replies] = await Promise.all([
        post.parentPostId
          ? prisma.post.findUnique({
              where: { id: post.parentPostId },
              include: postWithCountsInclude,
            })
          : Promise.resolve(null),
        prisma.post.findMany({
          where: { parentPostId: post.id },
          include: postWithCountsInclude,
          orderBy: { createdAt: "asc" },
        }),
      ]);

      return reply.send({
        parent: parent ? toFeedPost(parent) : null,
        post: toFeedPost(post),
        replies: replies.map(toFeedPost),
      });
    }
  );

  // Cached, opt-in transparency log of shared FactCheck results for this
  // post - no live AI call here, just reads the precomputed summary.
  app.get<{ Params: { id: string } }>(
    "/posts/:id/factcheck-summary",
    { preHandler: requireAuth },
    async (request, reply) => {
      const post = await prisma.post.findUnique({
        where: { id: request.params.id },
        select: { factCheckSummary: true, factCheckCount: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }
      return reply.send({
        count: post.factCheckCount,
        bucketLabel: post.factCheckCount > 10 ? "10+" : String(post.factCheckCount),
        summary: post.factCheckSummary,
      });
    }
  );

  // Strictly chronological feed (own posts + followed accounts), no ranking.
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/feed",
    { preHandler: requireAuth },
    async (request, reply) => {
      const limit = Math.min(
        Number(request.query.limit) || DEFAULT_LIMIT,
        50
      );
      const cursor = request.query.cursor;
      const viewerId = request.userId!;

      const [user, following, blockedIds, closeFriendGrantedAuthorIds] =
        await Promise.all([
          prisma.user.findUniqueOrThrow({ where: { id: viewerId } }),
          prisma.follow.findMany({
            where: { followerId: viewerId },
            select: { followeeId: true },
          }),
          getBlockedUserIds(viewerId),
          getCloseFriendGrantedAuthorIds(viewerId),
        ]);
      const authorIds = [
        viewerId,
        ...following.map((f) => f.followeeId),
      ].filter((id) => !blockedIds.includes(id));

      const posts = await prisma.post.findMany({
        where: {
          authorId: { in: authorIds },
          OR: [
            { visibility: "public" },
            { authorId: viewerId },
            {
              visibility: "close_friends",
              authorId: { in: closeFriendGrantedAuthorIds },
            },
          ],
        },
        include: postWithCountsInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor
          ? { cursor: { id: cursor }, skip: 1 }
          : {}),
      });

      const hasMore = posts.length > limit;
      const page = hasMore ? posts.slice(0, limit) : posts;
      const nextCursor = hasMore ? page[page.length - 1].id : null;

      const lastSeenAt = user.lastSeenPostCreatedAt;
      let boundaryIndex: number | null = null;
      if (lastSeenAt) {
        const idx = page.findIndex((p) => p.createdAt <= lastSeenAt);
        boundaryIndex = idx === -1 ? null : idx;
      } else if (page.length > 0) {
        // first ever visit: everything is "new", no boundary yet
        boundaryIndex = null;
      }
      const caughtUp = !hasMore && (boundaryIndex !== null || page.length === 0);

      const responseBody: FeedPage = {
        posts: page.map(toFeedPost),
        nextCursor,
        caughtUp,
        boundaryIndex,
      };
      return reply.send(responseBody);
    }
  );

  // Marks the newest post currently loaded in the feed as "seen" so the
  // caught-up boundary advances on the next visit.
  app.post<{ Body: { postId: string } }>(
    "/feed/mark-seen",
    { preHandler: requireAuth },
    async (request, reply) => {
      const post = await prisma.post.findUnique({
        where: { id: request.body.postId },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }
      await prisma.user.update({
        where: { id: request.userId! },
        data: {
          lastSeenPostId: post.id,
          lastSeenPostCreatedAt: post.createdAt,
        },
      });
      return reply.code(204).send();
    }
  );
}
