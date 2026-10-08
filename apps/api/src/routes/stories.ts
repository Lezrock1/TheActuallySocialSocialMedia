import type { FastifyInstance } from "fastify";
import { createStoryReactionSchema, createStorySchema } from "@app/shared";
import type { PostVisibility, Story, StoryGroup } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { deleteMediaIfUnreferenced } from "../storage.js";
import { ownsMedia } from "../mediaAccess.js";
import {
  circleMemberClause,
  getBlockedUserIds,
  getVisibilityGrants,
  isBlocked,
  visibleContentClauses,
} from "../visibility.js";
import { createUserNotification } from "../notifications.js";

const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_MEETUP_LEAD_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_LISTED_ATTENDEES = 20;

const storyInclude = {
  author: true,
  reactions: true,
  circle: { select: { id: true, name: true } },
  meetup: {
    include: {
      responses: { include: { user: true }, orderBy: { createdAt: "asc" as const } },
    },
  },
} as const;

type StoryRow = Awaited<ReturnType<typeof loadStory>>;

async function loadStory(id: string) {
  return prisma.story.findUnique({ where: { id }, include: storyInclude });
}

function toStoryDto(story: NonNullable<StoryRow>, viewerId: string): Story {
  return {
    id: story.id,
    imageKey: story.imageKey,
    audioKey: story.audioKey,
    audioDurationMs: story.audioDurationMs,
    text: story.text,
    createdAt: story.createdAt.toISOString(),
    expiresAt: story.expiresAt.toISOString(),
    visibility: story.visibility as PostVisibility,
    circle: story.circle ? { id: story.circle.id, name: story.circle.name } : null,
    meetup: story.meetup
      ? {
          id: story.meetup.id,
          title: story.meetup.title,
          startsAt: story.meetup.startsAt.toISOString(),
          place: story.meetup.place,
          attendeeCount: story.meetup.responses.length,
          attendees: story.meetup.responses
            .slice(0, MAX_LISTED_ATTENDEES)
            .map((response) => toPublicUser(response.user)),
          isGoing: story.meetup.responses.some((response) => response.userId === viewerId),
        }
      : null,
    reactionCounts: Array.from(
      story.reactions.reduce((counts, reaction) => {
        counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
      ([emoji, count]) => ({ emoji, count })
    ),
    myReaction: story.reactions.find((reaction) => reaction.userId === viewerId)?.emoji ?? null,
  };
}

// Reacting or RSVPing needs the same access as watching the story.
async function canInteractWithStory(
  viewerId: string,
  story: { authorId: string; visibility: string; circleId: string | null; expiresAt: Date }
): Promise<boolean> {
  if (story.expiresAt <= new Date()) return false;
  if (story.authorId === viewerId) return true;
  if (await isBlocked(viewerId, story.authorId)) return false;
  if (story.visibility === "circle") {
    return !!story.circleId && !!(await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId: story.circleId, userId: viewerId } },
      select: { id: true },
    }));
  }
  const followsAuthor = await prisma.follow.findUnique({
    where: { followerId_followeeId: { followerId: viewerId, followeeId: story.authorId } },
    select: { id: true },
  });
  if (!followsAuthor) return false;
  if (story.visibility === "close_friends") {
    return !!(await prisma.closeFriend.findUnique({
      where: { ownerId_friendId: { ownerId: story.authorId, friendId: viewerId } },
      select: { id: true },
    }));
  }
  return true;
}

export async function storyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/stories", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createStorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const input = parsed.data;
    if (!(await ownsMedia(request.userId!, input.imageKey))) {
      return reply.code(403).send({ error: "You can only attach your own uploads" });
    }
    if (input.audioKey && !(await ownsMedia(request.userId!, input.audioKey))) {
      return reply.code(403).send({ error: "You can only attach your own uploads" });
    }
    const visibility = input.visibility ?? "public";
    if (visibility === "circle") {
      const circle = await prisma.circle.findFirst({
        where: { id: input.circleId, ownerId: request.userId! },
        select: { id: true },
      });
      if (!circle) return reply.code(400).send({ error: "Choose one of your circles" });
    }
    let meetupStart: Date | null = null;
    if (input.meetup) {
      meetupStart = new Date(input.meetup.startsAt);
      const lead = meetupStart.getTime() - Date.now();
      if (lead < 0 || lead > MAX_MEETUP_LEAD_MS) {
        return reply.code(400).send({ error: "Pick a meetup time in the future (within a year)" });
      }
    }

    const story = await prisma.story.create({
      data: {
        authorId: request.userId!,
        imageKey: input.imageKey,
        audioKey: input.audioKey,
        audioDurationMs: input.audioKey ? input.audioDurationMs : null,
        text: input.text,
        visibility,
        circleId: visibility === "circle" ? input.circleId : null,
        expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
        ...(input.meetup && meetupStart
          ? {
              meetup: {
                create: {
                  authorId: request.userId!,
                  title: input.meetup.title || null,
                  startsAt: meetupStart,
                  place: input.meetup.place,
                },
              },
            }
          : {}),
      },
      include: storyInclude,
    });
    return reply.code(201).send({ story: toStoryDto(story, request.userId!) });
  });

  // Active stories from the user and accounts they follow, grouped by author.
  app.get("/stories", { preHandler: requireAuth }, async (request, reply) => {
    const viewerId = request.userId!;
    const [following, blockedIds, grants] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: viewerId },
        select: { followeeId: true },
      }),
      getBlockedUserIds(viewerId),
      getVisibilityGrants(viewerId),
    ]);
    const authorIds = [viewerId, ...following.map((f) => f.followeeId)].filter(
      (id) => !blockedIds.includes(id)
    );

    const stories = await prisma.story.findMany({
      where: {
        expiresAt: { gt: new Date() },
        OR: [
          { authorId: { in: authorIds }, OR: visibleContentClauses(viewerId, grants) },
          circleMemberClause(grants, blockedIds),
        ],
      },
      include: storyInclude,
      orderBy: { createdAt: "asc" },
    });

    const groups = new Map<string, StoryGroup>();
    for (const story of stories) {
      const storyDto = toStoryDto(story, viewerId);
      const existing = groups.get(story.authorId);
      if (existing) {
        existing.stories.push(storyDto);
      } else {
        groups.set(story.authorId, {
          author: toPublicUser(story.author),
          stories: [storyDto],
        });
      }
    }

    const orderedGroups = Array.from(groups.values()).sort((a, b) => {
      const latestA = a.stories[a.stories.length - 1]?.createdAt ?? "";
      const latestB = b.stories[b.stories.length - 1]?.createdAt ?? "";
      return latestB.localeCompare(latestA) || a.author.username.localeCompare(b.author.username);
    });
    return reply.send({ groups: orderedGroups });
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
        select: { id: true, authorId: true, visibility: true, circleId: true, expiresAt: true },
      });
      if (!story || !(await canInteractWithStory(request.userId!, story))) {
        return reply.code(404).send({ error: "Story not found" });
      }

      const existing = await prisma.storyReaction.findUnique({
        where: {
          storyId_userId: { storyId: story.id, userId: request.userId! },
        },
      });
      let shouldNotifyAuthor = false;
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
        shouldNotifyAuthor = true;
      }
      if (shouldNotifyAuthor) {
        await createUserNotification({
          recipientId: story.authorId,
          actorId: request.userId!,
          type: "story_reaction",
          dedupeKey: `story-reaction:${story.id}:${request.userId}`,
        }).catch((error) => request.log.error(error, "Story reaction notification creation failed"));
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

  // Toggles "I'm in" for a story meetup.
  app.post<{ Params: { id: string } }>(
    "/meetups/:id/going",
    { preHandler: requireAuth },
    async (request, reply) => {
      const meetup = await prisma.meetup.findUnique({
        where: { id: request.params.id },
        include: { story: { select: { id: true, authorId: true, visibility: true, circleId: true, expiresAt: true } } },
      });
      if (!meetup || !(await canInteractWithStory(request.userId!, meetup.story))) {
        return reply.code(404).send({ error: "Meetup not found" });
      }

      const existing = await prisma.meetupResponse.findUnique({
        where: { meetupId_userId: { meetupId: meetup.id, userId: request.userId! } },
      });
      if (existing) {
        await prisma.meetupResponse.delete({ where: { id: existing.id } });
      } else {
        await prisma.meetupResponse.create({
          data: { meetupId: meetup.id, userId: request.userId! },
        });
        await createUserNotification({
          recipientId: meetup.authorId,
          actorId: request.userId!,
          type: "meetup_response",
          dedupeKey: `meetup-response:${meetup.id}:${request.userId}`,
        }).catch((error) => request.log.error(error, "Meetup response notification failed"));
      }

      const story = await loadStory(meetup.story.id);
      return reply.send({ meetup: story ? toStoryDto(story, request.userId!).meetup : null });
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
      if (story.audioKey) await deleteMediaIfUnreferenced(story.audioKey);
      return reply.code(204).send();
    }
  );
}
