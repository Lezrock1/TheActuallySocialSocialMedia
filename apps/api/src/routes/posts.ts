import type { FastifyInstance } from "fastify";
import { createPostSchema } from "@app/shared";
import type { FeedItem, FeedPage } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { deleteMediaIfUnreferenced } from "../storage.js";
import { ownsMedia } from "../mediaAccess.js";
import { getBlockedUserIds, getCloseFriendGrantedAuthorIds } from "../visibility.js";
import { toPublicUser } from "../serializers.js";
import { postWithCountsInclude, toFeedPost } from "../postSerializer.js";
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
      (parsed.type !== "post" && parsed.type !== "follow") ||
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

    const post = await prisma.post.create({
      data: {
        authorId: request.userId!,
        text: parsed.data.text,
        imageKey: parsed.data.imageKey,
        parentPostId: parsed.data.parentPostId,
        visibility: parsed.data.visibility ?? "public",
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
            visibility: parsed.data.visibility ?? "public",
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
      const cursor = parseFeedCursor(request.query.cursor);
      if (request.query.cursor && !cursor) {
        return reply.code(400).send({ error: "Invalid feed cursor" });
      }
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

      const cursorDate = cursor ? new Date(cursor.createdAt) : null;
      const [posts, follows] = await Promise.all([
        prisma.post.findMany({
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
            ...(cursor && cursorDate
              ? {
                  AND: [
                    {
                      OR: [
                        { createdAt: { lt: cursorDate } },
                        ...(cursor.type === "post"
                          ? [{ createdAt: cursorDate, id: { lt: cursor.id } }]
                          : []),
                      ],
                    },
                  ],
                }
              : {}),
          },
          include: postWithCountsInclude,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        prisma.follow.findMany({
          where: {
            followerId: { in: authorIds },
            followeeId: { notIn: blockedIds },
            ...(cursor && cursorDate
              ? {
                  AND: [
                    {
                      OR: [
                        { createdAt: { lt: cursorDate } },
                        ...(cursor.type === "post"
                          ? [{ createdAt: cursorDate }]
                          : [{ createdAt: cursorDate, id: { lt: cursor.id } }]),
                      ],
                    },
                  ],
                }
              : {}),
          },
          include: { follower: true, followee: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
      ]);

      const items: FeedItem[] = [
        ...posts.map((post): FeedItem => ({
          type: "post",
          id: post.id,
          createdAt: post.createdAt.toISOString(),
          post: toFeedPost(post),
        })),
        ...follows.map((follow): FeedItem => ({
          type: "follow",
          id: follow.id,
          createdAt: follow.createdAt.toISOString(),
          follower: toPublicUser(follow.follower),
          followee: toPublicUser(follow.followee),
        })),
      ].sort(compareFeedItems);

      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? encodeFeedCursor(page[page.length - 1]) : null;

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
  app.post<{ Body: { itemId: string; itemType: "post" | "follow" } }>(
    "/feed/mark-seen",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { itemId, itemType } = request.body;
      if (itemType !== "post" && itemType !== "follow") {
        return reply.code(400).send({ error: "Invalid feed item type" });
      }

      const item = itemType === "post"
        ? await prisma.post.findUnique({ where: { id: itemId } })
        : await prisma.follow.findUnique({ where: { id: itemId } });
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
