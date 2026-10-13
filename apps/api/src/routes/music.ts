import type { FastifyInstance } from "fastify";
import type {
  MusicMix,
  MusicMixComment,
  MusicNowPlaying,
  MusicTaste,
  MusicTasteMatch,
  PublicUser,
} from "@app/shared";
import {
  createMusicMixCommentSchema,
  createMusicMixSchema,
  MUSIC_PROVIDERS,
  setNowPlayingSchema,
  updateMusicTasteSchema,
} from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { isBlocked } from "../visibility.js";
import { ownsMedia } from "../mediaAccess.js";
import { byUser, createRateLimiter, rateLimitBy } from "../rateLimit.js";

const nowPlayingLimiter = createRateLimiter({ windowMs: 60_000, max: 12 });
const mixCreateLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 6 });
const mixCommentLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const NOW_PLAYING_TTL_MS = 4 * 60 * 60 * 1000;
const MUSIC_HOSTS: Record<(typeof MUSIC_PROVIDERS)[number], string[]> = {
  spotify: ["open.spotify.com", "spotify.link"],
  apple_music: ["music.apple.com", "itunes.apple.com"],
  soundcloud: ["soundcloud.com", "on.soundcloud.com"],
};

function isProviderUrl(provider: (typeof MUSIC_PROVIDERS)[number], rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password && MUSIC_HOSTS[provider]
      .some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function toNowPlaying(row: {
  id: string;
  provider: string;
  title: string;
  artist: string;
  url: string;
  updatedAt: Date;
  user: Parameters<typeof toPublicUser>[0];
}): MusicNowPlaying {
  return {
    id: row.id,
    provider: row.provider as MusicNowPlaying["provider"],
    title: row.title,
    artist: row.artist,
    url: row.url,
    updatedAt: row.updatedAt.toISOString(),
    user: toPublicUser(row.user),
  };
}

function toMix(row: {
  id: string;
  title: string;
  description: string | null;
  audioKey: string;
  durationMs: number;
  waveform: unknown;
  tracklist: unknown;
  createdAt: Date;
  owner: Parameters<typeof toPublicUser>[0];
  _count?: { comments: number };
}): MusicMix {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    audioKey: row.audioKey,
    durationMs: row.durationMs,
    waveform: Array.isArray(row.waveform) ? row.waveform.filter((peak): peak is number => typeof peak === "number") : [],
    tracklist: Array.isArray(row.tracklist) ? row.tracklist as MusicMix["tracklist"] : [],
    createdAt: row.createdAt.toISOString(),
    owner: toPublicUser(row.owner),
    commentCount: row._count?.comments ?? 0,
  };
}

function toMixComment(row: {
  id: string;
  timestampMs: number;
  text: string;
  createdAt: Date;
  user: Parameters<typeof toPublicUser>[0];
}): MusicMixComment {
  return {
    id: row.id,
    timestampMs: row.timestampMs,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    user: toPublicUser(row.user),
  };
}

async function canViewMix(viewerId: string, mix: { ownerId: string; visibility: string }): Promise<boolean> {
  if (await isBlocked(viewerId, mix.ownerId)) return false;
  if (mix.ownerId === viewerId || mix.visibility === "public") return true;
  return !!(await prisma.follow.findUnique({
    where: { followerId_followeeId: { followerId: viewerId, followeeId: mix.ownerId } },
    select: { id: true },
  }));
}

async function areMutualFriends(userAId: string, userBId: string): Promise<boolean> {
  const follows = await prisma.follow.count({
    where: { OR: [
      { followerId: userAId, followeeId: userBId },
      { followerId: userBId, followeeId: userAId },
    ] },
  });
  return follows === 2;
}

async function getTasteMatch(userId: string, otherUserId: string): Promise<MusicTasteMatch> {
  const [mine, theirs] = await Promise.all([
    prisma.musicTaste.findUnique({ where: { userId } }),
    prisma.musicTaste.findUnique({ where: { userId: otherUserId } }),
  ]);
  const myGenres = mine?.genres ?? [];
  const theirGenres = theirs?.genres ?? [];
  const myTracks = mine?.favoriteTracks ?? [];
  const theirTracks = theirs?.favoriteTracks ?? [];
  const sharedGenres = new Map(theirGenres.map((genre) => [genre.trim().toLocaleLowerCase(), genre]));
  const sharedTracks = new Map(theirTracks.map((track) => [track.trim().toLocaleLowerCase(), track]));
  const genres = myGenres.filter((genre) => sharedGenres.has(genre.trim().toLocaleLowerCase()));
  const tracks = myTracks.filter((track) => sharedTracks.has(track.trim().toLocaleLowerCase()));
  const genreUnion = new Set([...myGenres, ...theirGenres].map((value) => value.trim().toLocaleLowerCase()));
  const trackUnion = new Set([...myTracks, ...theirTracks].map((value) => value.trim().toLocaleLowerCase()));
  const total = genreUnion.size + trackUnion.size;
  return {
    score: total === 0 ? 0 : Math.round(((genres.length + tracks.length) / total) * 100),
    sharedGenres: genres,
    sharedTracks: tracks,
  };
}

export async function musicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/music/now-playing/feed", { preHandler: requireAuth }, async (request, reply) => {
    const following = await prisma.follow.findMany({
      where: { followerId: request.userId! },
      select: { followeeId: true },
    });
    const userIds = [request.userId!, ...following.map((edge) => edge.followeeId)];
    const cutoff = new Date(Date.now() - NOW_PLAYING_TTL_MS);
    const rows = await prisma.musicNowPlaying.findMany({
      where: { userId: { in: userIds }, updatedAt: { gte: cutoff } },
      include: { user: true },
      orderBy: { updatedAt: "desc" },
      take: 24,
    });
    const blocked = await Promise.all(rows.map((row) => isBlocked(request.userId!, row.userId)));
    return reply.send({ statuses: rows.filter((_row, index) => !blocked[index]).map(toNowPlaying) });
  });

  app.get<{ Params: { username: string } }>("/music/now-playing/:username", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { username: request.params.username }, select: { id: true } });
    if (!user || await isBlocked(request.userId!, user.id)) return reply.code(404).send({ error: "Not found" });
    if (user.id !== request.userId) {
      const follows = await prisma.follow.findUnique({
        where: { followerId_followeeId: { followerId: request.userId!, followeeId: user.id } },
        select: { id: true },
      });
      if (!follows) return reply.code(404).send({ error: "Not found" });
    }
    const status = await prisma.musicNowPlaying.findUnique({ where: { userId: user.id }, include: { user: true } });
    if (!status || Date.now() - status.updatedAt.getTime() > NOW_PLAYING_TTL_MS) return reply.send({ status: null });
    return reply.send({ status: toNowPlaying(status) });
  });

  app.post("/music/now-playing", {
    preHandler: [requireAuth, rateLimitBy(nowPlayingLimiter, byUser)],
  }, async (request, reply) => {
    const parsed = setNowPlayingSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!isProviderUrl(parsed.data.provider, parsed.data.url)) {
      return reply.code(400).send({ error: "Use a secure link from the selected music service" });
    }
    const status = await prisma.musicNowPlaying.upsert({
      where: { userId: request.userId! },
      create: { ...parsed.data, userId: request.userId! },
      update: parsed.data,
      include: { user: true },
    });
    return reply.send({ status: toNowPlaying(status) });
  });

  app.delete("/music/now-playing", { preHandler: requireAuth }, async (request, reply) => {
    await prisma.musicNowPlaying.deleteMany({ where: { userId: request.userId! } });
    return reply.code(204).send();
  });

  app.get<{ Params: { username: string } }>("/music/taste/:username", { preHandler: requireAuth }, async (request, reply) => {
    const other = await prisma.user.findUnique({ where: { username: request.params.username }, select: { id: true } });
    if (!other || await isBlocked(request.userId!, other.id)) return reply.code(404).send({ error: "Not found" });
    if (other.id !== request.userId && !(await areMutualFriends(request.userId!, other.id))) {
      return reply.code(403).send({ error: "Music taste is shared with friends only" });
    }
    const taste = await prisma.musicTaste.findUnique({ where: { userId: other.id } });
    const result: MusicTaste = { genres: taste?.genres ?? [], favoriteTracks: taste?.favoriteTracks ?? [] };
    return reply.send({ taste: result });
  });

  app.patch("/music/taste", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = updateMusicTasteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const genres = [...new Set(parsed.data.genres.map((value) => value.trim()).filter(Boolean))];
    const favoriteTracks = [...new Set(parsed.data.favoriteTracks.map((value) => value.trim()).filter(Boolean))];
    const taste = await prisma.musicTaste.upsert({
      where: { userId: request.userId! },
      create: { userId: request.userId!, genres, favoriteTracks },
      update: { genres, favoriteTracks },
    });
    return reply.send({ taste: { genres: taste.genres, favoriteTracks: taste.favoriteTracks } satisfies MusicTaste });
  });

  app.get<{ Params: { username: string } }>("/music/taste-match/:username", { preHandler: requireAuth }, async (request, reply) => {
    const other = await prisma.user.findUnique({ where: { username: request.params.username }, select: { id: true } });
    if (!other || other.id === request.userId || await isBlocked(request.userId!, other.id)) {
      return reply.code(404).send({ error: "Not found" });
    }
    if (!(await areMutualFriends(request.userId!, other.id))) return reply.code(403).send({ error: "Taste match is available between friends only" });
    return reply.send({ match: await getTasteMatch(request.userId!, other.id) });
  });

  app.get("/music/mixes/feed", { preHandler: requireAuth }, async (request, reply) => {
    const following = await prisma.follow.findMany({ where: { followerId: request.userId! }, select: { followeeId: true } });
    const ownerIds = [request.userId!, ...following.map((edge) => edge.followeeId)];
    const rows = await prisma.musicMix.findMany({
      where: { ownerId: { in: ownerIds }, visibility: "public" },
      include: { owner: true, _count: { select: { comments: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    const blocked = await Promise.all(rows.map((row) => isBlocked(request.userId!, row.ownerId)));
    return reply.send({ mixes: rows.filter((_row, index) => !blocked[index]).map(toMix) });
  });

  app.get<{ Params: { username: string } }>("/music/mixes/user/:username", { preHandler: requireAuth }, async (request, reply) => {
    const owner = await prisma.user.findUnique({ where: { username: request.params.username }, select: { id: true } });
    if (!owner || await isBlocked(request.userId!, owner.id)) return reply.code(404).send({ error: "Not found" });
    const following = owner.id === request.userId || await prisma.follow.findUnique({
      where: { followerId_followeeId: { followerId: request.userId!, followeeId: owner.id } }, select: { id: true },
    });
    const rows = await prisma.musicMix.findMany({
      where: { ownerId: owner.id, ...(following ? {} : { visibility: "public" }) },
      include: { owner: true, _count: { select: { comments: true } } },
      orderBy: { createdAt: "desc" }, take: 20,
    });
    return reply.send({ mixes: rows.map(toMix) });
  });

  app.post("/music/mixes", {
    preHandler: [requireAuth, rateLimitBy(mixCreateLimiter, byUser)],
  }, async (request, reply) => {
    const parsed = createMusicMixSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await ownsMedia(request.userId!, parsed.data.audioKey))) {
      return reply.code(403).send({ error: "You can only attach your own audio uploads" });
    }
    const duplicate = await prisma.musicMix.findUnique({ where: { audioKey: parsed.data.audioKey }, select: { id: true } });
    if (duplicate) return reply.code(409).send({ error: "This upload is already attached to a mix" });
    const row = await prisma.musicMix.create({
      data: {
        ...parsed.data,
        ownerId: request.userId!,
        waveform: parsed.data.waveform,
        tracklist: parsed.data.tracklist,
      },
      include: { owner: true, _count: { select: { comments: true } } },
    });
    return reply.code(201).send({ mix: toMix(row) });
  });

  app.get<{ Params: { mixId: string } }>("/music/mixes/:mixId", { preHandler: requireAuth }, async (request, reply) => {
    const row = await prisma.musicMix.findUnique({
      where: { id: request.params.mixId },
      include: {
        owner: true,
        _count: { select: { comments: true } },
        comments: { include: { user: true }, orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }], take: 100 },
      },
    });
    if (!row || !(await canViewMix(request.userId!, row))) return reply.code(404).send({ error: "Mix not found" });
    return reply.send({ mix: toMix(row), comments: row.comments.map(toMixComment) });
  });

  app.post<{ Params: { mixId: string } }>("/music/mixes/:mixId/comments", {
    preHandler: [requireAuth, rateLimitBy(mixCommentLimiter, byUser)],
  }, async (request, reply) => {
    const parsed = createMusicMixCommentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const mix = await prisma.musicMix.findUnique({ where: { id: request.params.mixId } });
    if (!mix || !(await canViewMix(request.userId!, mix))) return reply.code(404).send({ error: "Mix not found" });
    if (parsed.data.timestampMs >= mix.durationMs) return reply.code(400).send({ error: "Comment timestamp exceeds mix duration" });
    const row = await prisma.musicMixComment.create({
      data: { ...parsed.data, mixId: mix.id, userId: request.userId! },
      include: { user: true },
    });
    return reply.code(201).send({ comment: toMixComment(row) });
  });
}
