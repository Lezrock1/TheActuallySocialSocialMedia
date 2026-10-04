import type { FastifyInstance } from "fastify";
import { updateProfileSchema } from "@app/shared";
import type { UserProfile } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { postWithCountsInclude, toFeedPost } from "../postSerializer.js";
import {
  getBlockedUserIds,
  getCloseFriendGrantedAuthorIds,
  isBlocked,
} from "../visibility.js";
import { ownsMedia } from "../mediaAccess.js";

const DEFAULT_LIMIT = 20;
const USER_DIRECTORY_LIMIT = 20;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; cursor?: string } }>(
    "/users",
    { preHandler: requireAuth },
    async (request, reply) => {
      const search = request.query.q?.trim().slice(0, 50) ?? "";
      const blockedUserIds = await getBlockedUserIds(request.userId!);
      const users = await prisma.user.findMany({
        where: {
          id: { not: request.userId!, notIn: blockedUserIds },
          ...(search
            ? {
                OR: [
                  { username: { contains: search, mode: "insensitive" as const } },
                  { displayName: { contains: search, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: USER_DIRECTORY_LIMIT + 1,
        ...(request.query.cursor
          ? { cursor: { id: request.query.cursor }, skip: 1 }
          : {}),
      });

      const hasMore = users.length > USER_DIRECTORY_LIMIT;
      const page = hasMore ? users.slice(0, USER_DIRECTORY_LIMIT) : users;
      return reply.send({
        users: page.map(toPublicUser),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      });
    }
  );

  app.patch("/users/me", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (
      parsed.data.avatarKey &&
      !(await ownsMedia(request.userId!, parsed.data.avatarKey))
    ) {
      return reply.code(403).send({ error: "You can only use your own uploads" });
    }
    const user = await prisma.user.update({
      where: { id: request.userId! },
      data: parsed.data,
    });
    return reply.send({ user: toPublicUser(user) });
  });

  app.get<{ Params: { username: string } }>(
    "/users/:username",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (await isBlocked(request.userId!, target.id)) {
        return reply.code(403).send({ error: "Not available" });
      }

      const [followerCount, followingCount, postCount, followEdge] =
        await Promise.all([
          prisma.follow.count({ where: { followeeId: target.id } }),
          prisma.follow.count({ where: { followerId: target.id } }),
          prisma.post.count({ where: { authorId: target.id } }),
          prisma.follow.findUnique({
            where: {
              followerId_followeeId: {
                followerId: request.userId!,
                followeeId: target.id,
              },
            },
          }),
        ]);

      const profile: UserProfile = {
        ...toPublicUser(target),
        bio: target.bio,
        followerCount,
        followingCount,
        postCount,
        isFollowedByMe: !!followEdge,
        isMe: target.id === request.userId,
      };
      return reply.send({ profile });
    }
  );

  // Chronological list of a user's own posts (not deleted, i.e. not soft-deleted -
  // deletion is permanent so this is simply "not previously removed").
  app.get<{ Params: { username: string }; Querystring: { cursor?: string } }>(
    "/users/:username/posts",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (await isBlocked(request.userId!, target.id)) {
        return reply.code(403).send({ error: "Not available" });
      }

      const isOwnProfile = target.id === request.userId;
      const closeFriendGrantedAuthorIds = isOwnProfile
        ? []
        : await getCloseFriendGrantedAuthorIds(request.userId!);

      const cursor = request.query.cursor;
      const posts = await prisma.post.findMany({
        where: {
          authorId: target.id,
          parentPostId: null,
          ...(isOwnProfile
            ? {}
            : {
                OR: [
                  { visibility: "public" },
                  {
                    visibility: "close_friends",
                    authorId: { in: closeFriendGrantedAuthorIds },
                  },
                ],
              }),
        },
        include: postWithCountsInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: DEFAULT_LIMIT + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = posts.length > DEFAULT_LIMIT;
      const page = hasMore ? posts.slice(0, DEFAULT_LIMIT) : posts;
      const nextCursor = hasMore ? page[page.length - 1].id : null;

      return reply.send({ posts: page.map(toFeedPost), nextCursor });
    }
  );
}
