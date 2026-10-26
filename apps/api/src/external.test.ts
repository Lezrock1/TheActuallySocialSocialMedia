import { describe, expect, it } from "vitest";
import type { ExternalFollow } from "@prisma/client";
import {
  bskyFeedToPosts,
  isYouTubeShort,
  mastodonStatusesToPosts,
  parseMastodonHandle,
  parseYouTubeRss,
  stripHtml,
} from "./external.js";

const followFixture = {
  id: "f1",
  userId: "u1",
  platform: "youtube",
  externalId: "UC123",
  handle: "channel",
  displayName: "Channel",
  avatarUrl: null,
  profileUrl: "https://www.youtube.com/@channel",
  createdAt: new Date(),
  lastSyncedAt: null,
} as ExternalFollow;

describe("parseMastodonHandle", () => {
  it("parses user@instance and defaults bare handles to mastodon.social", () => {
    expect(parseMastodonHandle("@user@infosec.exchange")).toEqual({ user: "user", instance: "infosec.exchange" });
    expect(parseMastodonHandle("user")).toEqual({ user: "user", instance: "mastodon.social" });
    expect(parseMastodonHandle("@a@b@c")).toBeNull();
  });
});

describe("stripHtml", () => {
  it("keeps readable text from Mastodon HTML content", () => {
    expect(stripHtml('<p>Hello <b>world</b></p><p>Second<br>line &amp; more</p>')).toBe("Hello world\n\nSecond\nline & more");
  });
});

describe("bskyFeedToPosts", () => {
  it("maps feed entries to external posts with bsky.app links", () => {
    const posts = bskyFeedToPosts("alice.bsky.social", [
      {
        post: {
          uri: "at://did:xyz/app.bsky.feed.post/abc123",
          record: { text: "Hello from Bluesky", createdAt: "2026-10-26T10:00:00.000Z" },
          embed: { images: [{ fullsize: "https://cdn/full.jpg", thumb: "https://cdn/thumb.jpg" }] },
        },
      },
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      platform: "bluesky",
      text: "Hello from Bluesky",
      mediaUrl: "https://cdn/full.jpg",
      url: "https://bsky.app/profile/alice.bsky.social/post/abc123",
    });
  });
});

describe("parseYouTubeRss", () => {
  it("extracts videos from a channel RSS feed", () => {
    const xml = `<?xml version="1.0"?><feed>
      <entry><yt:videoId>vid1</yt:videoId><title>First video</title><published>2026-10-25T09:00:00+00:00</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/vid1/hqdefault.jpg"/></media:group></entry>
      <entry><yt:videoId>vid2</yt:videoId><title>Second #Shorts clip</title><published>2026-10-26T09:00:00+00:00</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/vid2/hqdefault.jpg"/></media:group></entry>
    </feed>`;
    const posts = parseYouTubeRss(xml, followFixture);
    expect(posts.map((post) => post.externalId)).toEqual(["vid1", "vid2"]);
    expect(posts[0]?.url).toBe("https://www.youtube.com/watch?v=vid1");
    expect(posts[1]?.thumbnailUrl).toContain("vid2");
  });
});

describe("isYouTubeShort", () => {
  it("detects shorts by #shorts hashtag or duration up to 61 seconds", () => {
    expect(isYouTubeShort(undefined, "My day #shorts")).toBe(true);
    expect(isYouTubeShort("PT45S", "Regular title")).toBe(true);
    expect(isYouTubeShort("PT1M1S", "Regular title")).toBe(true);
    expect(isYouTubeShort("PT3M20S", "Regular title")).toBe(false);
    expect(isYouTubeShort(undefined, "Regular title")).toBe(false);
  });
});

describe("mastodonStatusesToPosts", () => {
  it("strips HTML and keeps media", () => {
    const posts = mastodonStatusesToPosts(followFixture, [
      {
        id: "109",
        content: "<p>Toot <a href=\"https://x\">link</a></p>",
        created_at: "2026-10-26T08:00:00.000Z",
        url: "https://mastodon.social/@user/109",
        media_attachments: [{ type: "image", url: "https://cdn/img.png", preview_url: "https://cdn/small.png" }],
      },
    ]);
    expect(posts[0]?.text).toBe("Toot link");
    expect(posts[0]?.mediaUrl).toBe("https://cdn/img.png");
  });
});
