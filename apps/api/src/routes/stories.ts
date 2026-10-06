import type { FastifyInstance } from "fastify";
import { createStoryReactionSchema, createStorySchema } from "@app/shared";
import type { PostVisibility, StoryGroup } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { deleteMediaIfUnreferenced } from "../storage.js";
import { ownsMedia } from "../mediaAccess.js";
import { getBlockedUserIds, getCloseFriendGrantedAuthorIds, isBlocked } from "../visibility.js";

const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function storyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/stories", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createStorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (!(await ownsMedia(request.userId!, parsed.data.imageKey))) {
      return reply.code(403).send({ error: "You can only attach your own uploads" });
    }

    const story = await prisma.story.create({
      data: {
        authorId: request.userId!,
        imageKey: parsed.data.imageKey,
        text: parsed.data.text,
        visibility: parsed.data.visibility ?? "public",
        expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
      },
    });
    return reply.code(201).send({
      story: {
        id: story.id,
        imageKey: story.imageKey,
        text: story.text,
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
      include: { author: true, reactions: true },
      orderBy: { createdAt: "asc" },
    });

    const groups = new Map<string, StoryGroup>();
    for (const story of stories) {
      const existing = groups.get(story.authorId);
      const storyDto = {
        id: story.id,
        imageKey: story.imageKey,
        text: story.text,
        createdAt: story.createdAt.toISOString(),
        expiresAt: story.expiresAt.toISOString(),
        visibility: story.visibility as PostVisibility,
        reactionCounts: Array.from(
          story.reactions.reduce((counts, reaction) => {
            counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1);
            return counts;
          }, new Map<string, number>()),
          ([emoji, count]) => ({ emoji, count })
        ),
        myReaction: story.reactions.find((reaction) => reaction.userId === viewerId)?.emoji ?? null,
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

  app.post<{ Params: { id: string } }>(
    "/stories/:id/reactions",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = createStoryReactionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const story = await prisma.story.findUnique({
        where: { id: request.params.id },
        select: { id: true, authorId: true, visibility: true, expiresAt: true },
      });
      if (!story || story.expiresAt <= new Date() || await isBlocked(request.userId!, story.authorId)) {
        return reply.code(404).send({ error: "Story not found" });
      }
      if (story.authorId !== request.userId) {
        const followsAuthor = await prisma.follow.findUnique({
          where: {
            followerId_followeeId: {
              followerId: request.userId!,
              followeeId: story.authorId,
            },
          },
        });
        if (!followsAuthor) return reply.code(404).send({ error: "Story not found" });
        if (story.visibility === "close_friends") {
          const closeFriend = await prisma.closeFriend.findUnique({
            where: {
              ownerId_friendId: {
                ownerId: story.authorId,
                friendId: request.userId!,
              },
            },
          });
          if (!closeFriend) return reply.code(404).send({ error: "Story not found" });
        }
      }

      const existing = await prisma.storyReaction.findUnique({
        where: {
          storyId_userId: { storyId: story.id, userId: request.userId! },
        },
      });
      if (existing?.emoji === parsed.data.emoji) {
        await prisma.storyReaction.delete({ where: { id: existing.id } });
      } else {
        await prisma.storyReaction.upsert({
          where: {
            storyId_userId: { storyId: story.id, userId: request.userId! },
          },
          create: { storyId: story.id, userId: request.userId!, emoji: parsed.data.emoji },
          update: { emoji: parsed.data.emoji },
        });
      }

      const reactions = await prisma.storyReaction.findMany({
        where: { storyId: story.id },
        select: { userId: true, emoji: true },
      });
      const reactionCounts = new Map<string, number>();
      for (const reaction of reactions) {
        reactionCounts.set(reaction.emoji, (reactionCounts.get(reaction.emoji) ?? 0) + 1);
      }
      return reply.send({
        reactionCounts: Array.from(reactionCounts, ([emoji, count]) => ({ emoji, count })),
        myReaction: reactions.find((reaction) => reaction.userId === request.userId)?.emoji ?? null,
      });
    }
  );

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
      await deleteMediaIfUnreferenced(story.imageKey);
      return reply.code(204).send();
    }
  );
}
