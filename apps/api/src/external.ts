import type { ExternalFollow } from "@prisma/client";
import type { ExternalFeedPost, ExternalPlatform, ExternalProfile, ExternalStoryItem, FeedItem } from "@app/shared";
import { prisma } from "./db.js";

const BSKY_API = "https://public.api.bsky.app/xrpc";
const MASTODON_DEFAULT_INSTANCE = "mastodon.social";
const STALE_AFTER_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? null;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? null;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET ?? null;

export function twitchConfigured(): boolean {
  return Boolean(TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "InTouch/1.0", ...(init?.headers ?? {}) },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Bluesky --

interface BskyActor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export function bskyProfileUrl(handle: string): string {
  return `https://bsky.app/profile/${handle}`;
}

export function bskyActorToProfile(actor: BskyActor): ExternalProfile {
  return {
    platform: "bluesky",
    externalId: actor.did,
    handle: actor.handle,
    displayName: actor.displayName ?? null,
    avatarUrl: actor.avatar ?? null,
    profileUrl: bskyProfileUrl(actor.handle),
  };
}

interface BskyFeedItem {
  post?: {
    uri: string;
    indexedAt?: string;
    record?: { text?: string; createdAt?: string };
    embed?: { images?: { fullsize?: string; thumb?: string }[] };
  };
}

export function bskyFeedToPosts(handle: string, items: BskyFeedItem[]): ExternalFeedPost[] {
  const posts: ExternalFeedPost[] = [];
  for (const item of items) {
    const post = item.post;
    if (!post?.uri) continue;
    const rkey = post.uri.split("/").pop();
    if (!rkey) continue;
    const image = post.embed?.images?.[0];
    posts.push({
      platform: "bluesky",
      externalId: post.uri,
      authorHandle: handle,
      authorName: null,
      authorAvatarUrl: null,
      profileUrl: bskyProfileUrl(handle),
      text: post.record?.text ?? null,
      mediaUrl: image?.fullsize ?? image?.thumb ?? null,
      thumbnailUrl: image?.thumb ?? null,
      url: `${bskyProfileUrl(handle)}/post/${rkey}`,
      publishedAt: post.record?.createdAt ?? post.indexedAt ?? new Date().toISOString(),
    });
  }
  return posts;
}

export async function bskySearch(query: string): Promise<ExternalProfile[]> {
  const data = await fetchJson<{ actors?: BskyActor[] }>(
    `${BSKY_API}/app.bsky.actor.searchActors?q=${encodeURIComponent(query)}&limit=8`
  );
  return (data?.actors ?? []).map(bskyActorToProfile);
}

export async function bskyResolve(handle: string): Promise<ExternalProfile | null> {
  const data = await fetchJson<{ did?: string } & BskyActor>(
    `${BSKY_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`
  );
  return data?.did ? bskyActorToProfile(data) : null;
}

async function bskyFetchPosts(follow: ExternalFollow): Promise<ExternalFeedPost[]> {
  const data = await fetchJson<{ feed?: BskyFeedItem[] }>(
    `${BSKY_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(follow.externalId)}&limit=15&filter=posts_no_replies`
  );
  return bskyFeedToPosts(follow.handle, data?.feed ?? []);
}

// --------------------------------------------------------------- Mastodon --

export function parseMastodonHandle(raw: string): { user: string; instance: string } | null {
  const cleaned = raw.trim().replace(/^@/, "");
  const parts = cleaned.split("@").filter(Boolean);
  if (parts.length === 1 && parts[0]) return { user: parts[0], instance: MASTODON_DEFAULT_INSTANCE };
  if (parts.length === 2 && parts[0] && parts[1]) return { user: parts[0], instance: parts[1] };
  return null;
}

interface MastodonAccount {
  id: string;
  acct: string;
  username: string;
  display_name?: string;
  avatar?: string;
  url?: string;
}

export function mastodonAccountToProfile(account: MastodonAccount, instance: string): ExternalProfile {
  const handle = account.acct.includes("@") ? account.acct : `${account.acct}@${instance}`;
  return {
    platform: "mastodon",
    externalId: `${account.id}@${instance}`,
    handle,
    displayName: account.display_name || null,
    avatarUrl: account.avatar ?? null,
    profileUrl: account.url ?? `https://${instance}/@${account.username}`,
  };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

interface MastodonStatus {
  id: string;
  content: string;
  created_at: string;
  url?: string;
  media_attachments?: { type: string; url?: string; preview_url?: string }[];
}

export function mastodonStatusesToPosts(follow: ExternalFollow, statuses: MastodonStatus[]): ExternalFeedPost[] {
  return statuses.map((status) => {
    const media = status.media_attachments?.find((item) => item.url);
    return {
      platform: "mastodon" as const,
      externalId: status.id,
      authorHandle: follow.handle,
      authorName: follow.displayName,
      authorAvatarUrl: follow.avatarUrl,
      profileUrl: follow.profileUrl,
      text: stripHtml(status.content) || null,
      mediaUrl: media?.url ?? null,
      thumbnailUrl: media?.preview_url ?? null,
      url: status.url ?? follow.profileUrl,
      publishedAt: status.created_at,
    };
  });
}

export async function mastodonSearch(query: string): Promise<ExternalProfile[]> {
  const exact = parseMastodonHandle(query);
  if (exact && query.includes("@")) {
    const account = await fetchJson<MastodonAccount>(
      `https://${exact.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(exact.user)}`
    );
    return account ? [mastodonAccountToProfile(account, exact.instance)] : [];
  }
  const data = await fetchJson<{ accounts?: MastodonAccount[] }>(
    `https://${MASTODON_DEFAULT_INSTANCE}/api/v2/search?q=${encodeURIComponent(query)}&type=accounts&limit=8`
  );
  return (data?.accounts ?? []).map((account) => mastodonAccountToProfile(account, MASTODON_DEFAULT_INSTANCE));
}

export async function mastodonResolve(handle: string): Promise<ExternalProfile | null> {
  const parsed = parseMastodonHandle(handle);
  if (!parsed) return null;
  const account = await fetchJson<MastodonAccount>(
    `https://${parsed.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(parsed.user)}`
  );
  return account ? mastodonAccountToProfile(account, parsed.instance) : null;
}

async function mastodonFetchPosts(follow: ExternalFollow): Promise<ExternalFeedPost[]> {
  const [accountId, instance] = follow.externalId.split("@");
  if (!accountId || !instance) return [];
  const statuses = await fetchJson<MastodonStatus[]>(
    `https://${instance}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?limit=15&exclude_replies=true&exclude_reblogs=true`
  );
  return mastodonStatusesToPosts(follow, statuses ?? []);
}

// ---------------------------------------------------------------- YouTube --

export function parseYouTubeRss(xml: string, follow: ExternalFollow): ExternalFeedPost[] {
  const posts: ExternalFeedPost[] = [];
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  for (const entry of entries.slice(0, 15)) {
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = entry.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    const thumbnail = entry.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] ?? null;
    if (!videoId || !published) continue;
    posts.push({
      platform: "youtube",
      externalId: videoId,
      authorHandle: follow.handle,
      authorName: follow.displayName,
      authorAvatarUrl: follow.avatarUrl,
      profileUrl: follow.profileUrl,
      text: title || null,
      mediaUrl: null,
      thumbnailUrl: thumbnail,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: published,
    });
  }
  return posts;
}

export function isYouTubeShort(durationIso: string | undefined, title: string): boolean {
  if (title.toLowerCase().includes("#shorts")) return true;
  if (!durationIso) return false;
  const match = durationIso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return false;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 && seconds <= 61;
}

async function youtubeResolve(handle: string): Promise<ExternalProfile | null> {
  const cleaned = handle.trim().replace(/^@/, "");
  if (!cleaned) return null;
  if (YOUTUBE_API_KEY) {
    const data = await fetchJson<{ items?: { id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }[] }>(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent(cleaned)}&key=${YOUTUBE_API_KEY}`
    );
    const channel = data?.items?.[0];
    if (channel) {
      return {
        platform: "youtube",
        externalId: channel.id,
        handle: cleaned,
        displayName: channel.snippet?.title ?? null,
        avatarUrl: channel.snippet?.thumbnails?.default?.url ?? null,
        profileUrl: `https://www.youtube.com/@${cleaned}`,
      };
    }
  }
  // Keyless fallback: read the public channel page once and extract the channel id.
  try {
    const res = await fetch(`https://www.youtube.com/@${encodeURIComponent(cleaned)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (compatible; InTouch/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const channelId = html.match(/"externalId":"(UC[^"]+)"/)?.[1] ?? html.match(/"channelId":"(UC[^"]+)"/)?.[1];
    if (!channelId) return null;
    const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? null;
    const avatar = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
    return {
      platform: "youtube",
      externalId: channelId,
      handle: cleaned,
      displayName: title,
      avatarUrl: avatar,
      profileUrl: `https://www.youtube.com/@${cleaned}`,
    };
  } catch {
    return null;
  }
}

export async function youtubeSearch(query: string): Promise<ExternalProfile[]> {
  if (YOUTUBE_API_KEY) {
    const data = await fetchJson<{ items?: { id?: { channelId?: string }; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }[] }>(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=8&q=${encodeURIComponent(query)}&key=${YOUTUBE_API_KEY}`
    );
    return (data?.items ?? [])
      .filter((item) => item.id?.channelId)
      .map((item) => ({
        platform: "youtube" as const,
        externalId: item.id!.channelId!,
        handle: item.snippet?.title ?? "",
        displayName: item.snippet?.title ?? null,
        avatarUrl: item.snippet?.thumbnails?.default?.url ?? null,
        profileUrl: `https://www.youtube.com/channel/${item.id!.channelId}`,
      }));
  }
  const resolved = await youtubeResolve(query);
  return resolved ? [resolved] : [];
}

async function youtubeFetchPosts(follow: ExternalFollow): Promise<ExternalFeedPost[]> {
  const xml = await (async () => {
    try {
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(follow.externalId)}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  })();
  if (!xml) return [];
  const posts = parseYouTubeRss(xml, follow);
  if (YOUTUBE_API_KEY && posts.length > 0) {
    const ids = posts.map((post) => post.externalId).join(",");
    const data = await fetchJson<{ items?: { id: string; contentDetails?: { duration?: string } }[] }>(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${YOUTUBE_API_KEY}`
    );
    const durations = new Map((data?.items ?? []).map((item) => [item.id, item.contentDetails?.duration]));
    for (const post of posts) {
      (post as ExternalFeedPost & { isShort?: boolean }).isShort = isYouTubeShort(durations.get(post.externalId), post.text ?? "");
    }
  }
  return posts;
}

// ----------------------------------------------------------------- Twitch --

let twitchTokenCache: { token: string; expiresAt: number } | null = null;

async function twitchToken(): Promise<string | null> {
  if (!twitchConfigured()) return null;
  if (twitchTokenCache && twitchTokenCache.expiresAt > Date.now() + 60_000) return twitchTokenCache.token;
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID!,
      client_secret: TWITCH_CLIENT_SECRET!,
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  twitchTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return twitchTokenCache.token;
}

async function twitchApi<T>(path: string): Promise<T | null> {
  const token = await twitchToken();
  if (!token) return null;
  return fetchJson<T>(`https://api.twitch.tv/helix${path}`, {
    headers: { "client-id": TWITCH_CLIENT_ID!, authorization: `Bearer ${token}` },
  });
}

interface TwitchChannel {
  id: string;
  login: string;
  display_name?: string;
  profile_image_url?: string;
  is_live?: boolean;
}

function twitchChannelToProfile(channel: TwitchChannel): ExternalProfile {
  return {
    platform: "twitch",
    externalId: channel.login,
    handle: channel.login,
    displayName: channel.display_name ?? null,
    avatarUrl: channel.profile_image_url ?? null,
    profileUrl: `https://www.twitch.tv/${channel.login}`,
  };
}

export async function twitchSearch(query: string): Promise<ExternalProfile[]> {
  const data = await twitchApi<{ data?: TwitchChannel[] }>(`/search/channels?query=${encodeURIComponent(query)}&first=8`);
  return (data?.data ?? []).map(twitchChannelToProfile);
}

export async function twitchResolve(login: string): Promise<ExternalProfile | null> {
  const cleaned = login.trim().replace(/^@/, "").toLowerCase();
  if (!cleaned) return null;
  const data = await twitchApi<{ data?: TwitchChannel[] }>(`/users?login=${encodeURIComponent(cleaned)}`);
  const channel = data?.data?.[0];
  return channel ? twitchChannelToProfile(channel) : null;
}

export async function twitchLiveLogins(logins: string[]): Promise<Map<string, { title: string; thumbnailUrl: string }>> {
  const live = new Map<string, { title: string; thumbnailUrl: string }>();
  if (logins.length === 0) return live;
  const query = logins.map((login) => `user_login=${encodeURIComponent(login)}`).join("&");
  const data = await twitchApi<{ data?: { user_login: string; title?: string; thumbnail_url?: string }[] }>(`/streams?${query}`);
  for (const stream of data?.data ?? []) {
    live.set(stream.user_login.toLowerCase(), {
      title: stream.title ?? "Live",
      thumbnailUrl: stream.thumbnail_url?.replace("{width}", "320").replace("{height}", "180") ?? "",
    });
  }
  return live;
}

// ------------------------------------------------------------------- Sync --

export async function resolveProfile(platform: ExternalPlatform, handle: string): Promise<ExternalProfile | null> {
  switch (platform) {
    case "bluesky": return bskyResolve(handle);
    case "mastodon": return mastodonResolve(handle);
    case "youtube": return youtubeResolve(handle);
    case "twitch": return twitchResolve(handle);
  }
}

export async function searchProfiles(platform: ExternalPlatform, query: string): Promise<ExternalProfile[]> {
  switch (platform) {
    case "bluesky": return bskySearch(query);
    case "mastodon": return mastodonSearch(query);
    case "youtube": return youtubeSearch(query);
    case "twitch": return twitchConfigured() ? twitchSearch(query) : [];
  }
}

async function fetchFollowPosts(follow: ExternalFollow): Promise<ExternalFeedPost[]> {
  switch (follow.platform as ExternalPlatform) {
    case "bluesky": return bskyFetchPosts(follow);
    case "mastodon": return mastodonFetchPosts(follow);
    case "youtube": return youtubeFetchPosts(follow);
    case "twitch": return []; // Twitch contributes live status, not posts.
    default: return [];
  }
}

export async function syncFollow(follow: ExternalFollow): Promise<void> {
  const posts = await fetchFollowPosts(follow);
  for (const post of posts) {
    const isShort = (post as ExternalFeedPost & { isShort?: boolean }).isShort ?? false;
    await prisma.externalPost.upsert({
      where: { followId_externalId: { followId: follow.id, externalId: post.externalId } },
      create: {
        followId: follow.id,
        platform: post.platform,
        externalId: post.externalId,
        text: post.text,
        mediaUrl: post.mediaUrl,
        thumbnailUrl: post.thumbnailUrl,
        isShort,
        url: post.url,
        publishedAt: new Date(post.publishedAt),
      },
      update: {
        text: post.text,
        mediaUrl: post.mediaUrl,
        thumbnailUrl: post.thumbnailUrl,
        isShort,
        url: post.url,
        publishedAt: new Date(post.publishedAt),
      },
    });
  }
  await prisma.externalFollow.update({ where: { id: follow.id }, data: { lastSyncedAt: new Date() } });
}

export async function syncStaleExternalFollows(userId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await prisma.externalFollow.findMany({
    where: {
      userId,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
    },
    take: 8,
  });
  await Promise.allSettled(stale.map((follow) => syncFollow(follow)));
}

export async function externalFeedItems(userId: string): Promise<FeedItem[]> {
  const follows = await prisma.externalFollow.findMany({
    where: { userId, platform: { in: ["bluesky", "mastodon", "youtube"] } },
    include: {
      posts: { orderBy: { publishedAt: "desc" }, take: 5 },
    },
  });
  const items: FeedItem[] = [];
  for (const follow of follows) {
    for (const post of follow.posts) {
      items.push({
        type: "external",
        id: `external:${post.id}`,
        createdAt: post.publishedAt.toISOString(),
        external: {
          platform: post.platform as ExternalPlatform,
          externalId: post.externalId,
          authorHandle: follow.handle,
          authorName: follow.displayName,
          authorAvatarUrl: follow.avatarUrl,
          profileUrl: follow.profileUrl,
          text: post.text,
          mediaUrl: post.mediaUrl,
          thumbnailUrl: post.thumbnailUrl,
          url: post.url,
          publishedAt: post.publishedAt.toISOString(),
        },
      });
    }
  }
  return items;
}

export async function externalStoryItems(userId: string): Promise<ExternalStoryItem[]> {
  const follows = await prisma.externalFollow.findMany({
    where: { userId, platform: { in: ["youtube", "twitch"] } },
    include: {
      posts: {
        where: { isShort: true, publishedAt: { gt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
        orderBy: { publishedAt: "desc" },
        take: 3,
      },
    },
  });
  const items: ExternalStoryItem[] = [];
  const twitchFollows = follows.filter((follow) => follow.platform === "twitch");
  const liveMap = await twitchLiveLogins(twitchFollows.map((follow) => follow.externalId));
  for (const follow of twitchFollows) {
    const live = liveMap.get(follow.externalId.toLowerCase());
    if (!live) continue;
    items.push({
      id: `twitch:${follow.externalId}`,
      platform: "twitch",
      title: live.title,
      thumbnailUrl: live.thumbnailUrl || null,
      url: follow.profileUrl,
      authorName: follow.displayName ?? follow.handle,
      authorAvatarUrl: follow.avatarUrl,
      live: true,
    });
  }
  for (const follow of follows) {
    if (follow.platform !== "youtube") continue;
    for (const post of follow.posts) {
      items.push({
        id: `youtube:${post.externalId}`,
        platform: "youtube",
        title: post.text ?? "New Short",
        thumbnailUrl: post.thumbnailUrl,
        url: post.url,
        authorName: follow.displayName ?? follow.handle,
        authorAvatarUrl: follow.avatarUrl,
        live: false,
      });
    }
  }
  return items.sort((a, b) => Number(b.live) - Number(a.live));
}
