import type { FastifyInstance } from "fastify";
import { createPostSchema, extractHashtags, normalizeHashtag } from "@app/shared";
import type { FeedItem, FeedPage } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { deleteMediaIfUnreferenced } from "../storage.js";
import { ownsMedia } from "../mediaAccess.js";
import {
  canViewContent,
  circleMemberClause,
  getBlockedUserIds,
  getVisibilityGrants,
  visibleContentClauses,
} from "../visibility.js";
import { toPublicUser } from "../serializers.js";
import { postWithCountsInclude, toFeedPost } from "../postSerializer.js";
import { externalFeedItems, syncStaleExternalFollows } from "../external.js";
import { createMentionNotifications, createPostNotifications } from "../notifications.js";

const DEFAULT_LIMIT = 20;

type FeedCursor = Pick<FeedItem, "type" | "id" | "createdAt">;

function parseFeedCursor(value?: string): FeedCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      type?: unknown;
      id?: unknown;
      createdAt?: unknown;
    };
    if (
      (parsed.type !== "post" && parsed.type !== "follow" && parsed.type !== "external") ||
      typeof parsed.id !== "string" ||
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(new Date(parsed.createdAt).getTime())
    ) {
      return null;
    }
    return {
      type: parsed.type,
      id: parsed.id,
      createdAt: new Date(parsed.createdAt).toISOString(),
    };
  } catch {
    return null;
  }
}

function encodeFeedCursor(item: FeedItem): string {
  return Buffer.from(
    JSON.stringify({ type: item.type, id: item.id, createdAt: item.createdAt })
  ).toString("base64url");
}

function compareFeedItems(a: FeedItem, b: FeedItem): number {
  const dateOrder = b.createdAt.localeCompare(a.createdAt);
  if (dateOrder) return dateOrder;
  if (a.type !== b.type) return a.type === "post" ? -1 : 1;
  return b.id.localeCompare(a.id);
}

export async function postRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { cursor?: string } }>("/notifications/friends-activity", { preHandler: requireAuth }, async (request, reply) => {
    const cursor = parseFeedCursor(request.query.cursor);
    if (request.query.cursor && (!cursor || cursor.type !== "follow")) return reply.code(400).send({ error: "Invalid activity cursor" });
    const [following, blockedIds] = await Promise.all([
      prisma.follow.findMany({ where: { followerId: request.userId! }, select: { followeeId: true } }),
      getBlockedUserIds(request.userId!),
    ]);
    const rows = await prisma.follow.findMany({
      where: {
        followerId: { in: following.map((follow) => follow.followeeId).filter((id) => !blockedIds.includes(id)) },
        followeeId: { notIn: blockedIds },
        ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}),
      },
      include: { follower: true, followee: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: DEFAULT_LIMIT + 1,
    });
    const activities = rows.slice(0, DEFAULT_LIMIT).map((follow): Extract<FeedItem, { type: "follow" }> => ({ type: "follow", id: follow.id, createdAt: follow.createdAt.toISOString(), follower: toPublicUser(follow.follower), followee: toPublicUser(follow.followee) }));
    return reply.send({ activities, nextCursor: rows.length > DEFAULT_LIMIT ? encodeFeedCursor(activities[activities.length - 1]) : null });
  });
  app.get<{ Params: { tag: string }; Querystring: { cursor?: string } }>("/hashtags/:tag/posts", { preHandler: requireAuth }, async (request, reply) => {
    const tag = normalizeHashtag(request.params.tag);
    if (!/^[\p{L}\p{N}_]{1,64}$/u.test(tag)) return reply.code(400).send({ error: "Invalid hashtag" });
    const viewerId = request.userId!;
    const [blockedIds, grants] = await Promise.all([getBlockedUserIds(viewerId), getVisibilityGrants(viewerId)]);
    const cursor = request.query.cursor ? await prisma.post.findUnique({ where: { id: request.query.cursor }, select: { id: true, createdAt: true } }) : null;
    if (request.query.cursor && !cursor) return reply.code(400).send({ error: "Invalid cursor" });
    const rows = await prisma.post.findMany({
      where: {
        hashtags: { has: tag }, parentPostId: null, authorId: { notIn: blockedIds },
        AND: [{ OR: visibleContentClauses(viewerId, grants) }, ...(cursor ? [{ OR: [
          { createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] }] : [])],
      },
      include: postWithCountsInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
    });
    const posts = rows.slice(0, 20);
    return reply.send({ posts: posts.map(toFeedPost), nextCursor: rows.length > 20 ? posts[posts.length - 1].id : null });
  });
  app.post("/posts", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createPostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (!parsed.data.text && !parsed.data.imageKey && !parsed.data.poll) {
      return reply.code(400).send({ error: "Post needs text, an image, or a poll" });
    }
    if (parsed.data.poll && parsed.data.parentPostId) {
      return reply.code(400).send({ error: "Polls can only be added to top-level posts" });
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
    const visibility = parsed.data.visibility ?? "public";
    if (visibility === "circle") {
      const circle = await prisma.circle.findFirst({
        where: { id: parsed.data.circleId, ownerId: request.userId! },
        select: { id: true },
      });
      if (!circle) return reply.code(400).send({ error: "Choose one of your circles" });
    }

    const post = await prisma.post.create({
      data: {
        authorId: request.userId!,
        text: parsed.data.text,
        hashtags: extractHashtags(parsed.data.text ?? ""),
        imageKey: parsed.data.imageKey,
        mediaType: parsed.data.mediaType ?? "image",
        parentPostId: parsed.data.parentPostId,
        visibility,
        circleId: visibility === "circle" ? parsed.data.circleId : null,
        ...(parsed.data.poll
          ? {
              poll: {
                create: {
                  question: parsed.data.poll.question,
                  options: {
                    create: parsed.data.poll.options.map((option, position) => ({
                      text: option,
                      position,
                    })),
                  },
                },
              },
            }
          : {}),
      },
      include: postWithCountsInclude,
    });

    const notificationTasks = [
      createMentionNotifications({
        text: post.text ?? "",
        actorId: request.userId!,
        postId: post.id,
      }).catch((error) => request.log.error(error, "Post mention notification creation failed")),
      ...(!post.parentPostId
        ? [createPostNotifications({
            authorId: request.userId!,
            postId: post.id,
            visibility,
            circleId: post.circleId,
          }).catch((error) => request.log.error(error, "Post notification creation failed"))]
        : []),
    ];
    await Promise.all(notificationTasks);

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
      if (!(await canViewContent(request.userId!, post))) {
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
        parent: parent && await canViewContent(request.userId!, parent) ? toFeedPost(parent) : null,
        post: toFeedPost(post),
        replies: (await Promise.all(
          replies.map(async (item) => (await canViewContent(request.userId!, item) ? item : null))
        )).filter((item) => item !== null).map(toFeedPost),
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
        select: { factCheckSummary: true, factCheckCount: true, authorId: true, visibility: true, circleId: true },
      });
      if (!post || !(await canViewContent(request.userId!, post))) {
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
      const cursor = parseFeedCursor(request.query.cursor);
      if (request.query.cursor && !cursor) {
        return reply.code(400).send({ error: "Invalid feed cursor" });
      }
      const viewerId = request.userId!;

      const [user, following, blockedIds, grants] =
        await Promise.all([
          prisma.user.findUniqueOrThrow({ where: { id: viewerId } }),
          prisma.follow.findMany({
            where: { followerId: viewerId },
            select: { followeeId: true },
          }),
          getBlockedUserIds(viewerId),
          getVisibilityGrants(viewerId),
        ]);
      const authorIds = [
        viewerId,
        ...following.map((f) => f.followeeId),
      ].filter((id) => !blockedIds.includes(id));

      const cursorDate = cursor ? new Date(cursor.createdAt) : null;
      // On the first page, fetch a wider window so posts with fresh comments
      // from people you follow can be bumped to the top of the feed.
      const isFirstPage = !cursor;
      const fetchLimit = isFirstPage ? Math.min(limit * 3, 60) : limit;
      const posts = await prisma.post.findMany({
          where: {
            AND: [
              {
                OR: [
                  { authorId: { in: authorIds }, OR: visibleContentClauses(viewerId, grants) },
                  circleMemberClause(grants, blockedIds),
                ],
              },
              ...(cursor && cursorDate
                ? [{
                    OR: [
                      { createdAt: { lt: cursorDate } },
                      ...(cursor.type === "post"
                        ? [{ createdAt: cursorDate, id: { lt: cursor.id } }]
                        : []),
                    ],
                  }]
                : []),
            ],
          },
          include: postWithCountsInclude,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: fetchLimit + 1,
        });

      const fetchedBeyondWindow = posts.length > fetchLimit;
      const windowPosts = fetchedBeyondWindow ? posts.slice(0, fetchLimit) : posts;
      const items: FeedItem[] = windowPosts.map((post): FeedItem => ({
        type: "post",
        id: post.id,
        createdAt: post.createdAt.toISOString(),
        post: toFeedPost(post),
      }));

      if (isFirstPage) {
        // Refresh stale external follows in the background; the cached posts
        // from followed Bluesky/Mastodon/YouTube profiles merge into the feed.
        void syncStaleExternalFollows(viewerId).catch(() => undefined);
      }
      items.push(...(await externalFeedItems(viewerId, { limit, cursor, authorIds })));

      if (isFirstPage && items.length > 1) {
        const friendIds = following
          .map((follow) => follow.followeeId)
          .filter((id) => !blockedIds.includes(id));
        const latestFriendCommentAt = new Map<string, Date>();
        if (friendIds.length > 0) {
          const friendComments = await prisma.comment.findMany({
            where: {
              postId: { in: items.filter((item) => item.type === "post").map((item) => item.id) },
              authorId: { in: friendIds },
            },
            orderBy: { createdAt: "desc" },
            select: { postId: true, createdAt: true },
          });
          for (const comment of friendComments) {
            if (comment.postId !== null && !latestFriendCommentAt.has(comment.postId)) {
              latestFriendCommentAt.set(comment.postId, comment.createdAt);
            }
          }
        }
        const activityTime = (item: FeedItem) => Math.max(
          latestFriendCommentAt.get(item.id)?.getTime() ?? 0,
          new Date(item.createdAt).getTime()
        );
        items.sort((a, b) => activityTime(b) - activityTime(a) || compareFeedItems(a, b));
      } else {
        items.sort(compareFeedItems);
      }

      const page = items.slice(0, limit);
      // More content exists when the DB window had extra posts OR the
      // activity-sorted window itself exceeds the page size – otherwise the
      // feed would stop after the first page and "caught up" stuck to the
      // bottom permanently.
      const hasMore = fetchedBeyondWindow || items.length > limit;
      const oldestInPage = page.reduce<FeedItem | null>(
        (oldest, item) => oldest && compareFeedItems(oldest, item) >= 0 ? oldest : item,
        null
      );
      const nextCursor = hasMore && oldestInPage ? encodeFeedCursor(oldestInPage) : null;

      const lastSeenAt = user.lastSeenPostCreatedAt;
      let boundaryIndex: number | null = null;
      if (lastSeenAt) {
        const idx = page.findIndex((item) => new Date(item.createdAt) <= lastSeenAt);
        boundaryIndex = idx === -1 ? null : idx;
      } else if (page.length > 0) {
        // first ever visit: everything is "new", no boundary yet
        boundaryIndex = null;
      }
      const caughtUp = !hasMore && (boundaryIndex !== null || page.length === 0);

      const responseBody: FeedPage = {
        items: page,
        nextCursor,
        caughtUp,
        boundaryIndex,
      };
      return reply.send(responseBody);
    }
  );

  // Marks the newest post currently loaded in the feed as "seen" so the
  // caught-up boundary advances on the next visit.
  app.post<{ Body: { itemId: string; itemType: FeedItem["type"] } }>(
    "/feed/mark-seen",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { itemId, itemType } = request.body;
      if (itemType !== "post" && itemType !== "follow" && itemType !== "external") {
        return reply.code(400).send({ error: "Invalid feed item type" });
      }

      let item: { id: string; createdAt: Date } | null = itemType === "post"
        ? await prisma.post.findUnique({ where: { id: itemId } })
        : itemType === "follow" ? await prisma.follow.findUnique({ where: { id: itemId } }) : null;
      if (itemType === "external" && itemId.startsWith("external:")) {
        const external = await prisma.externalPost.findFirst({ where: { id: itemId.slice(9), follow: { userId: request.userId! } } });
        if (external) item = { id: external.id, createdAt: external.publishedAt };
      } else if (itemType === "external" && itemId.startsWith("repost:")) {
        const [following, blocked] = await Promise.all([
          prisma.follow.findMany({ where: { followerId: request.userId! }, select: { followeeId: true } }),
          getBlockedUserIds(request.userId!),
        ]);
        item = await prisma.externalRepost.findFirst({ where: {
          id: itemId.slice(7),
          userId: { in: [request.userId!, ...following.map((follow) => follow.followeeId)].filter((id) => !blocked.includes(id)) },
        } });
      }
      if (!item) return reply.code(404).send({ error: "Feed item not found" });

      await prisma.user.update({
        where: { id: request.userId! },
        data: {
          lastSeenPostId: itemType === "post" ? item.id : null,
          lastSeenPostCreatedAt: item.createdAt,
        },
      });
      return reply.code(204).send();
    }
  );
}
