export interface TrackSuggestion {
  id: string;
  title: string;
  artist: string;
  appleUrl: string;
}
export interface MusicLinks { spotify: string; apple_music: string; soundcloud?: string }

export function musicSearchLinks(title: string, artist: string): MusicLinks {
  const query = encodeURIComponent(`${artist} ${title}`.trim());
  return { spotify: `https://open.spotify.com/search/${query}`, apple_music: `https://music.apple.com/us/search?term=${query}` };
}

export function validMusicLink(provider: string, rawUrl: string): boolean {
  const hosts: Record<string, string[]> = {
    spotify: ["open.spotify.com", "spotify.link"], apple_music: ["music.apple.com", "itunes.apple.com"],
    soundcloud: ["soundcloud.com", "on.soundcloud.com"],
  };
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password && (hosts[provider] ?? []).includes(url.hostname);
  } catch { return false; }
}

export async function searchTracks(query: string): Promise<TrackSuggestion[]> {
  const response = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error("Music search temporarily unavailable");
  const body = await response.json() as { results?: unknown[] };
  return (Array.isArray(body.results) ? body.results : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.trackName !== "string" || typeof row.artistName !== "string" || typeof row.trackViewUrl !== "string" ||
      typeof row.trackId !== "number" || !validMusicLink("apple_music", row.trackViewUrl)) return [];
    return [{ id: String(row.trackId), title: row.trackName, artist: row.artistName, appleUrl: row.trackViewUrl }];
  });
}

export async function resolveMusicLinks(title: string, artist: string, appleUrl: string): Promise<MusicLinks> {
  const links = musicSearchLinks(title, artist);
  if (!validMusicLink("apple_music", appleUrl)) return links;
  links.apple_music = appleUrl;
  try {
    const response = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(appleUrl)}`, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return links;
    const data = await response.json() as { linksByPlatform?: Record<string, { url?: unknown }> };
    for (const [platform, provider] of [["spotify", "spotify"], ["appleMusic", "apple_music"], ["soundcloud", "soundcloud"]] as const) {
      const url = data.linksByPlatform?.[platform]?.url;
      if (typeof url === "string" && validMusicLink(provider, url)) links[provider] = url;
    }
  } catch { return links; }
  return links;
}