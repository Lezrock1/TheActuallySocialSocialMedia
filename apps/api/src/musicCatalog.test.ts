import { afterEach, describe, expect, it, vi } from "vitest";
import { musicSearchLinks, resolveMusicLinks, searchTracks, validMusicLink } from "./musicCatalog.js";

afterEach(() => vi.unstubAllGlobals());
describe("music catalog", () => {
  it("builds search links for corrected titles without retaining the previous track", () => {
    expect(decodeURIComponent(musicSearchLinks("New track", "New artist").spotify)).toContain("New artist New track");
    expect(musicSearchLinks("New track", "New artist").soundcloud).toBeUndefined();
  });
  it("rejects wrong hosts, credentials and insecure links", () => {
    expect(validMusicLink("spotify", "https://open.spotify.com/track/123")).toBe(true);
    expect(validMusicLink("spotify", "https://open.spotify.com.evil.test/track/123")).toBe(false);
    expect(validMusicLink("spotify", "https://user:pass@open.spotify.com/track/123")).toBe(false);
    expect(validMusicLink("apple_music", "http://music.apple.com/track/123")).toBe(false);
  });
  it("filters catalog results and returns actual artist and Apple track links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [
      { trackId: 1, trackName: "One More Time", artistName: "Daft Punk", trackViewUrl: "https://music.apple.com/us/album/one-more-time/1?i=2" },
      { trackId: 2, trackName: "Bad", artistName: "Bad", trackViewUrl: "https://evil.test/" },
    ] }))));
    expect(await searchTracks("One More Time")).toEqual([
      { id: "1", title: "One More Time", artist: "Daft Punk", appleUrl: "https://music.apple.com/us/album/one-more-time/1?i=2" },
    ]);
  });
  it("resolves Spotify, Apple and available SoundCloud links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ linksByPlatform: {
      spotify: { url: "https://open.spotify.com/track/one" }, appleMusic: { url: "https://music.apple.com/us/album/one/1" },
      soundcloud: { url: "https://soundcloud.com/artist/one" },
    } }))));
    expect(await resolveMusicLinks("One", "Artist", "https://music.apple.com/us/album/one/1")).toEqual({
      spotify: "https://open.spotify.com/track/one", apple_music: "https://music.apple.com/us/album/one/1", soundcloud: "https://soundcloud.com/artist/one",
    });
  });
  it("keeps accurate Apple links and Spotify search as explicit fallback when resolution fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await resolveMusicLinks("One", "Artist", "https://music.apple.com/us/album/one/1");
    expect(result.apple_music).toBe("https://music.apple.com/us/album/one/1");
    expect(result.spotify).toContain("/search/");
    expect(result.soundcloud).toBeUndefined();
  });
});