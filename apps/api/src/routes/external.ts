import type { FastifyInstance } from "fastify";
import { EXTERNAL_PLATFORMS, EXTERNAL_SUGGESTION_TOPICS } from "@app/shared";
import type { ExternalFollowSummary, ExternalPlatform, ExternalProfile, ExternalStoryItem, ExternalSuggestionTopic } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { suggestionEntries } from "../externalSuggestions.js";
import {
  externalStoryItems,
  resolveProfile,
  searchProfiles,
  syncFollow,
  syncStaleExternalFollows,
  twitchConfigured,
  twitchLiveLogins,
} from "../external.js";

function parsePlatform(value?: string): ExternalPlatform | null {
  return value && (EXTERNAL_PLATFORMS as readonly string[]).includes(value) ? (value as ExternalPlatform) : null;
}

export async function externalRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { platform?: string; q?: string } }>(
    "/external/search",
    { preHandler: requireAuth },
    async (request, reply) => {
      const platform = parsePlatform(request.query.platform);
      if (!platform) return reply.code(400).send({ error: "Unknown platform" });
      const query = request.query.q?.trim() ?? "";
      if (!query) return reply.send({ profiles: [] });
      if (platform === "twitch" && !twitchConfigured()) return reply.send({ profiles: [], configured: false });
      const profiles = await searchProfiles(platform, query);
      return reply.send({ profiles });
    }
  );

  app.get<{ Querystring: { platform?: string; topic?: string } }>(
    "/external/suggestions",
    { preHandler: requireAuth },
    async (request, reply) => {
      const platform = parsePlatform(request.query.platform);
      if (!platform) return reply.code(400).send({ error: "Unknown platform" });
      const topic: ExternalSuggestionTopic = (EXTERNAL_SUGGESTION_TOPICS as readonly string[]).includes(request.query.topic ?? "")
        ? (request.query.topic as ExternalSuggestionTopic)
        : "trending";
      const user = await prisma.user.findUnique({
        where: { id: request.userId! },
        select: { translationLanguage: true },
      });
      const entries = suggestionEntries(platform, topic, user?.translationLanguage ?? "en").slice(0, 6);
      const profiles = (
        await Promise.all(entries.map((entry) => resolveProfile(platform, entry.handle).catch(() => null)))
      ).filter((profile): profile is ExternalProfile => profile !== null);
      return reply.send({ profiles });
    }
  );

  app.get("/external/follows", { preHandler: requireAuth }, async (request, reply) => {
    const follows = await prisma.externalFollow.findMany({
      where: { userId: request.userId! },
      orderBy: { createdAt: "desc" },
    });
    const liveMap = await twitchLiveLogins(
      follows.filter((follow) => follow.platform === "twitch").map((follow) => follow.externalId)
    );
    const summaries: ExternalFollowSummary[] = follows.map((follow) => ({
      platform: follow.platform as ExternalPlatform,
      externalId: follow.externalId,
      handle: follow.handle,
      displayName: follow.displayName,
      avatarUrl: follow.avatarUrl,
      profileUrl: follow.profileUrl,
      followId: follow.id,
      isLive: liveMap.has(follow.externalId.toLowerCase()),
      lastSyncedAt: follow.lastSyncedAt?.toISOString() ?? null,
    }));
    return reply.send({ follows: summaries });
  });

  app.post<{ Body: { platform?: string; handle?: string } }>(
    "/external/follows",
    { preHandler: requireAuth },
    async (request, reply) => {
      const platform = parsePlatform(request.body?.platform);
      if (!platform) return reply.code(400).send({ error: "Unknown platform" });
      const handle = request.body?.handle?.trim() ?? "";
      if (!handle) return reply.code(400).send({ error: "Missing handle" });
      if (platform === "twitch" && !twitchConfigured()) {
        return reply.code(503).send({ error: "Twitch is not configured on this server" });
      }
      const profile = await resolveProfile(platform, handle);
      if (!profile) return reply.code(404).send({ error: "Profile not found" });
      const follow = await prisma.externalFollow.upsert({
        where: {
          userId_platform_externalId: {
            userId: request.userId!,
            platform,
            externalId: profile.externalId,
          },
        },
        create: {
          userId: request.userId!,
          platform,
          externalId: profile.externalId,
          handle: profile.handle,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          profileUrl: profile.profileUrl,
        },
        update: {
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          profileUrl: profile.profileUrl,
        },
      });
      void syncFollow(follow).catch(() => undefined);
      return reply.code(201).send({ followId: follow.id });
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/external/follows/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const follow = await prisma.externalFollow.findUnique({ where: { id: request.params.id } });
      if (!follow || follow.userId !== request.userId) {
        return reply.code(404).send({ error: "Follow not found" });
      }
      await prisma.externalFollow.delete({ where: { id: follow.id } });
      return reply.code(204).send();
    }
  );

  app.get("/external/story-items", { preHandler: requireAuth }, async (request, reply) => {
    void syncStaleExternalFollows(request.userId!).catch(() => undefined);
    const items: ExternalStoryItem[] = await externalStoryItems(request.userId!);
    return reply.send({ items });
  });
}
