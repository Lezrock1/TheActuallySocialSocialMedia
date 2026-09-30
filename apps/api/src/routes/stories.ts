import type { FastifyInstance } from "fastify";
import { createStorySchema } from "@app/shared";
import type { PostVisibility, StoryGroup } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { deleteMedia } from "../storage.js";
import { getBlockedUserIds, getCloseFriendGrantedAuthorIds } from "../visibility.js";

const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function storyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/stories", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createStorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const story = await prisma.story.create({
      data: {
        authorId: request.userId!,
        imageKey: parsed.data.imageKey,
        visibility: parsed.data.visibility ?? "public",
        expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
      },
    });
    return reply.code(201).send({
      story: {
        id: story.id,
        imageKey: story.imageKey,
        createdAt: story.createdAt.toISOString(),
        expiresAt: story.expiresAt.toISOString(),
        visibility: story.visibility as PostVisibility,
      },
    });
  });

  // Active stories from the user and accounts they follow, grouped by author.
  app.get("/stories", { preHandler: requireAuth }, async (request, reply) => {
    const viewerId = request.userId!;
    const [following, blockedIds, closeFriendGrantedAuthorIds] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: viewerId },
        select: { followeeId: true },
      }),
      getBlockedUserIds(viewerId),
      getCloseFriendGrantedAuthorIds(viewerId),
    ]);
    const authorIds = [viewerId, ...following.map((f) => f.followeeId)].filter(
      (id) => !blockedIds.includes(id)
    );

    const stories = await prisma.story.findMany({
      where: {
        authorId: { in: authorIds },
        expiresAt: { gt: new Date() },
        OR: [
          { visibility: "public" },
          { authorId: viewerId },
          {
            visibility: "close_friends",
            authorId: { in: closeFriendGrantedAuthorIds },
          },
        ],
      },
      include: { author: true },
      orderBy: { createdAt: "asc" },
    });

    const groups = new Map<string, StoryGroup>();
    for (const story of stories) {
      const existing = groups.get(story.authorId);
      const storyDto = {
        id: story.id,
        imageKey: story.imageKey,
        createdAt: story.createdAt.toISOString(),
        expiresAt: story.expiresAt.toISOString(),
        visibility: story.visibility as PostVisibility,
      };
      if (existing) {
        existing.stories.push(storyDto);
      } else {
        groups.set(story.authorId, {
          author: toPublicUser(story.author),
          stories: [storyDto],
        });
      }
    }

    return reply.send({ groups: Array.from(groups.values()) });
  });

  app.delete<{ Params: { id: string } }>(
    "/stories/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const story = await prisma.story.findUnique({
        where: { id: request.params.id },
      });
      if (!story || story.authorId !== request.userId) {
        return reply.code(404).send({ error: "Story not found" });
      }
      await prisma.story.delete({ where: { id: story.id } });
      await deleteMedia(story.imageKey);
      return reply.code(204).send();
    }
  );
}
