import { test, expect } from "@playwright/test";
import { PrismaClient } from "../../apps/api/node_modules/@prisma/client/default.js";
import { API } from "../seed.mjs";
import { readFile } from "node:fs/promises";

const database = new PrismaClient({ datasourceUrl: "postgresql://app:app@localhost:5432/e2e" });
test.afterAll(() => database.$disconnect());
test.beforeEach(async ({ context }, info) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${info.testId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 240 + 1}` });
  await context.request.post(`${API}/users/me/update-notice/acknowledge`);
});

test("post photos open full screen and close with Escape or the close button", async ({ page, context }) => {
  const media = await context.request.post(`${API}/media`, { multipart: { file: { name: "post-photo.png", mimeType: "image/png", buffer: await readFile(new URL("../../apps/web/public/apple-touch-icon.png", import.meta.url)) } } });
  expect(media.status()).toBe(201);
  const imageKey = (await media.json()).key;
  const response = await context.request.post(`${API}/posts`, { data: { imageKey, text: "Enlarge this photo" } });
  expect(response.status()).toBe(201);
  const { post } = await response.json();
  try {
    await page.goto(`/post/${post.id}`);
    const open = page.getByRole("button", { name: "Enlarge photo by @leo" });
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Photo", exact: true });
    await expect(dialog.getByRole("img", { name: "Photo", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await open.click();
    await page.getByRole("button", { name: "Close photo", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally { await context.request.delete(`${API}/posts/${post.id}`); }
});

for (const platform of ["bluesky", "mastodon", "youtube"]) {
  test(`${platform} feed posts translate into the preferred language and toggle the result`, async ({ page }, info) => {
    const headers = { "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true" };
    await page.route(/\/users\/me\/preferences$/, (route) => route.fulfill({ headers, json: { translationLanguage: "fr" } }));
    await page.route(/\/feed\?/, (route) => route.fulfill({ headers, json: {
      items: [{ type: "external", id: "external:test", createdAt: new Date().toISOString(), external: {
        platform, externalId: "external-test", authorHandle: "author", authorName: "Test author", authorAvatarUrl: null,
        profileUrl: "https://example.com", text: "A post to translate", mediaUrl: null, thumbnailUrl: null,
        url: "https://example.com/post", publishedAt: new Date().toISOString(),
      } }], nextCursor: null, caughtUp: true, boundaryIndex: null,
    } }));
    let requests = 0;
    await page.route(/\/ai\/translate$/, async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: { ...headers, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" }, body: "" });
      requests += 1;
      expect(route.request().postDataJSON()).toEqual({ externalPost: { platform, externalId: "external-test", url: "https://example.com/post" } });
      return route.fulfill({ headers, json: { translation: "Une publication traduite" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Translate to Français", exact: true }).click();
    await expect(page.getByText("Une publication traduite", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Hide translation", exact: true }).click();
    await expect(page.getByText("Une publication traduite", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Translate to Français", exact: true }).click();
    await expect(page.getByText("Une publication traduite", { exact: true })).toBeVisible();
    expect(requests).toBe(1);
    await page.screenshot({ path: `screenshots/${info.project.name}/external-translation-${platform}.png`, animations: "disabled" });
  });
}

for (const platform of ["bluesky", "mastodon", "youtube"]) {
  test(`${platform} repost reaches followers, respects filters and blocks, and supports undo`, async ({ page, context, browser }, info) => {
    const leo = await database.user.findUniqueOrThrow({ where: { username: "leo" } });
    const mia = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
    const stamp = `${platform}-${Date.now()}-${info.project.name}`;
    const originalFollow = await database.follow.findUnique({ where: { followerId_followeeId: { followerId: mia.id, followeeId: leo.id } } });
    await database.follow.upsert({ where: { followerId_followeeId: { followerId: mia.id, followeeId: leo.id } }, create: { followerId: mia.id, followeeId: leo.id }, update: {} });
    const source = await database.externalFollow.create({ data: {
      userId: leo.id, platform, externalId: stamp, handle: stamp, displayName: "External author",
      profileUrl: "https://example.com/profile", lastSyncedAt: new Date(),
    } });
    const post = await database.externalPost.create({ data: {
      followId: source.id, platform, externalId: stamp, text: `Shared story ${stamp}`,
      url: `https://example.com/${stamp}`, publishedAt: new Date(),
    } });
    const reference = { platform, externalId: stamp, url: post.url };
    const recipient = await browser.newContext({ storageState: ".auth/mia.json", extraHTTPHeaders: { "x-forwarded-for": "198.51.100.61" } });
    const originalPreferences = await (await recipient.request.get(`${API}/external/preferences`)).json();
    const ownPreferences = await (await context.request.get(`${API}/external/preferences`)).json();
    let block = null;
    try {
      await context.request.patch(`${API}/external/preferences`, { data: { hiddenPlatforms: [] } });
      await recipient.request.patch(`${API}/external/preferences`, { data: { hiddenPlatforms: [] } });
      await page.goto("/");
      await page.locator("article").filter({ hasText: `Shared story ${stamp}` }).getByRole("button", { name: "Repost", exact: true }).click();
      await expect.poll(() => database.externalRepost.count({ where: { userId: leo.id, externalId: stamp } })).toBe(1);
      const first = await context.request.post(`${API}/external/reposts`, { data: reference });
      expect(first.status()).toBe(201);
      const duplicate = await context.request.post(`${API}/external/reposts`, { data: reference });
      expect((await duplicate.json()).repostId).toBe((await first.json()).repostId);
      const feed = async () => (await (await recipient.request.get(`${API}/feed`)).json()).items;
      const visible = await feed();
      const repost = visible.find((item) => item.external?.externalId === stamp);
      expect(repost?.external.repostedBy.username).toBe("leo");
      expect(repost?.external.authorHandle).toBe(stamp);
      const seen = await recipient.request.post(`${API}/feed/mark-seen`, { data: { itemId: repost.id, itemType: "external" } });
      expect(seen.status()).toBe(204);
      await recipient.request.delete(`${API}/external/reposts`, { data: reference });
      expect((await feed()).some((item) => item.external?.externalId === stamp)).toBe(true);
      const hidden = await recipient.request.patch(`${API}/external/preferences`, { data: { hiddenPlatforms: [platform] } });
      expect(hidden.status()).toBe(200);
      expect((await feed()).some((item) => item.external?.externalId === stamp)).toBe(false);
      const invalid = await recipient.request.patch(`${API}/external/preferences`, { data: { hiddenPlatforms: ["intouch"] } });
      expect(invalid.status()).toBe(400);
      await recipient.request.patch(`${API}/external/preferences`, { data: { hiddenPlatforms: [] } });
      block = await database.blockedUser.create({ data: { blockerId: leo.id, blockedId: mia.id } });
      expect((await feed()).some((item) => item.external?.externalId === stamp)).toBe(false);
      expect((await recipient.request.post(`${API}/external/reposts`, { data: reference })).status()).toBe(404);
      await database.blockedUser.delete({ where: { id: block.id } }); block = null;
      expect((await recipient.request.post(`${API}/external/reposts`, { data: reference })).status()).toBe(201);
      await recipient.request.delete(`${API}/external/reposts`, { data: reference });
      await database.externalFollow.delete({ where: { id: source.id } });
      expect((await feed()).some((item) => item.external?.externalId === stamp)).toBe(true);
      await page.goto("/");
      const card = page.locator("article").filter({ hasText: `Shared story ${stamp}` });
      await expect(card.getByRole("button", { name: "Undo repost", exact: true })).toBeVisible();
      await page.screenshot({ path: `screenshots/${info.project.name}/repost-${platform}.png`, animations: "disabled" });
      await card.getByRole("button", { name: "Undo repost", exact: true }).click();
      await expect.poll(async () => (await feed()).some((item) => item.external?.externalId === stamp)).toBe(false);
      await page.goto("/settings/appearance");
      await expect(page.getByText("Always on", { exact: true })).toBeVisible();
      const toggle = page.getByRole("switch", { name: "Bluesky", exact: true });
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await page.reload();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await page.getByRole("region", { name: "Feed sources", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `screenshots/${info.project.name}/feed-sources-${platform}.png`, animations: "disabled" });
    } finally {
      if (block) await database.blockedUser.deleteMany({ where: { id: block.id } });
      await database.externalRepost.deleteMany({ where: { externalId: stamp } });
      await database.externalFollow.deleteMany({ where: { id: source.id } });
      if (!originalFollow) await database.follow.deleteMany({ where: { followerId: mia.id, followeeId: leo.id } });
      await recipient.request.patch(`${API}/external/preferences`, { data: originalPreferences });
      await context.request.patch(`${API}/external/preferences`, { data: ownPreferences });
      await database.user.update({ where: { id: mia.id }, data: { lastSeenPostId: mia.lastSeenPostId, lastSeenPostCreatedAt: mia.lastSeenPostCreatedAt } });
      await recipient.close();
    }
  });
}

test("a repost-only first page paginates beyond twenty posts", async ({ context, browser }) => {
  const leo = await database.user.findUniqueOrThrow({ where: { username: "leo" } });
  const mia = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
  const stamp = `pagination-${Date.now()}`;
  const originalFollow = await database.follow.findUnique({ where: { followerId_followeeId: { followerId: mia.id, followeeId: leo.id } } });
  await database.follow.upsert({ where: { followerId_followeeId: { followerId: mia.id, followeeId: leo.id } }, create: { followerId: mia.id, followeeId: leo.id }, update: {} });
  const recipient = await browser.newContext({ storageState: ".auth/mia.json", extraHTTPHeaders: { "x-forwarded-for": "198.51.100.62" } });
  const originalPreferences = await (await recipient.request.get(`${API}/external/preferences`)).json();
  await database.externalRepost.createMany({ data: Array.from({ length: 30 }, (_, index) => ({
    userId: leo.id, platform: "bluesky", externalId: `${stamp}-${index}`, authorHandle: "source",
    profileUrl: "https://example.com", url: `https://example.com/${stamp}/${index}`, publishedAt: new Date(),
    createdAt: new Date(Date.now() + 3600000 + index * 1000),
  })) });
  try {
    await recipient.request.patch(`${API}/external/preferences`, { data: { hiddenPlatforms: [] } });
    const seen = new Set();
    const cursors = new Set();
    let cursor = null;
    for (let pageIndex = 0; pageIndex < 12; pageIndex += 1) {
      const response = await recipient.request.get(`${API}/feed?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(response.status()).toBe(200);
      const page = await response.json();
      for (const item of page.items) if (item.external?.externalId.startsWith(stamp)) {
        expect(seen.has(item.id)).toBe(false); seen.add(item.id);
      }
      if (seen.size === 30 || !page.nextCursor) break;
      expect(cursors.has(page.nextCursor)).toBe(false);
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    }
    expect(seen.size).toBe(30);
    await recipient.request.patch(`${API}/external/preferences`, { data: { hiddenPlatforms: ["bluesky", "mastodon", "youtube", "twitch"] } });
    const native = await (await recipient.request.get(`${API}/feed`)).json();
    expect(native.items.some((item) => item.type === "post")).toBe(true);
    expect(native.items.every((item) => item.type !== "external")).toBe(true);
  } finally {
    await database.externalRepost.deleteMany({ where: { userId: leo.id, externalId: { startsWith: stamp } } });
    if (!originalFollow) await database.follow.deleteMany({ where: { followerId: mia.id, followeeId: leo.id } });
    await recipient.request.patch(`${API}/external/preferences`, { data: originalPreferences });
    await recipient.close();
  }
});

test("installable app requests a fixed upright portrait orientation", async ({ page }) => {
  await page.goto("/");
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestUrl).toBeTruthy();
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).orientation).toBe("portrait-primary");
});

test("dashboard total sums all recorded buckets and fits mobile", async ({ page, context }, info) => {
  const response = await context.request.get(`${API}/public/usage-metrics`);
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  const rows = await database.usageMetricBucket.groupBy({ by: ["metric"], where: { metric: { in: Object.keys(data.total) }, bucket: { gte: new Date(data.trackingSince), lt: new Date(data.asOf) } }, _sum: { count: true } });
  for (const key of Object.keys(data.total)) expect(data.total[key]).toBe(rows.find((row) => row.metric === key)?._sum.count ?? 0);
  await page.goto("/dashboard");
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: `screenshots/${info.project.name}/dashboard-total-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: `screenshots/${info.project.name}/dashboard-total-desktop.png`, fullPage: true });
});

test("following suggestions smoothly replaces them until no candidates remain", async ({ page }, info) => {
  const headers = { "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true" };
  let candidates = Array.from({ length: 4 }, (_, index) => ({ id: `candidate-${index}`, username: `candidate${index}`, displayName: `Candidate ${index}`, avatarKey: null, createdAt: new Date().toISOString(), mutualCount: 0 }));
  await page.route(/\/users\/suggestions$/, (route) => route.fulfill({ headers, json: { users: candidates.slice(0, 3) } }));
  await page.route(/\/users\/candidate\d\/follow$/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...headers, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type,x-forwarded-for" } });
    const username = route.request().url().split("/").at(-2);
    candidates = candidates.filter((person) => person.username !== username);
    return route.fulfill({ status: 204, headers });
  });
  await page.goto("/people");
  const list = page.getByRole("region", { name: "People you may know" });
  await expect(list.getByRole("button", { name: /^Follow @/ })).toHaveCount(3);
  await page.screenshot({ path: `screenshots/${info.project.name}/profile-suggestions-mobile.png`, fullPage: true });
  const mobileViewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: `screenshots/${info.project.name}/profile-suggestions-desktop.png`, fullPage: true });
  await page.setViewportSize(mobileViewport);
  for (let index = 0; index < 4; index++) {
    await list.getByRole("button", { name: `Follow @candidate${index}`, exact: true }).click();
    await expect(list.getByRole("button", { name: `Follow @candidate${index}`, exact: true })).toHaveCount(0);
    await expect(list.getByRole("button", { name: /^Follow @/ })).toHaveCount(Math.min(3, 3 - index));
  }
  await expect(page.getByText("No more suggestions right now.")).toBeVisible();
});

test("following from a profile refreshes suggestions when returning to search", async ({ page, context }) => {
  const leo = await database.user.findUniqueOrThrow({ where: { username: "leo" } });
  const mia = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
  const where = { followerId: leo.id, followeeId: mia.id };
  const original = await database.follow.findUnique({ where: { followerId_followeeId: where } });
  await database.follow.deleteMany({ where });
  try {
    await page.goto("/people");
    const suggestions = page.getByRole("region", { name: "People you may know" });
    await suggestions.locator('a[href="/u/mia"]').click();
    await page.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unfollow", exact: true })).toBeVisible();
    await page.goBack();
    await expect(suggestions).toBeVisible();
    await expect(suggestions.locator('a[href="/u/mia"]')).toHaveCount(0);
    const response = await context.request.get(`${API}/users/suggestions`);
    expect((await response.json()).users.some((person) => person.id === mia.id)).toBe(false);
  } finally {
    await database.follow.deleteMany({ where });
    if (original) await database.follow.create({ data: original });
  }
});

test("mobile navigation stays at viewport bottom, outside transformed content, and recovers after keyboard", async ({ page }, info) => {
  await page.goto("/");
  const nav = page.locator('nav[aria-label="Primary navigation"]:visible');
  await expect(nav).toBeVisible();
  await page.evaluate(() => {
    document.getElementById("root").style.transform = "translateY(120px)";
    document.body.style.minHeight = "3000px";
    window.scrollTo(0, 600);
  });
  let box = await nav.boundingBox();
  expect(Math.abs(page.viewportSize().height - box.y - box.height)).toBeLessThan(2);
  expect(Math.abs(box.x)).toBeLessThan(2);
  expect(Math.abs(box.width - page.viewportSize().width)).toBeLessThan(2);
  const surface = await nav.evaluate((element) => {
    const style = getComputedStyle(element);
    return { bottomPadding: parseFloat(style.paddingBottom), background: style.backgroundColor };
  });
  expect(surface.bottomPadding).toBeGreaterThanOrEqual(20);
  expect(surface.background).toMatch(/^rgb\(/);
  const field = page.getByRole("textbox").first();
  await field.focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: window.innerHeight - 300 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(nav).not.toBeVisible();
  await field.blur();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: window.innerHeight });
    window.visualViewport.dispatchEvent(new Event("resize"));
    document.getElementById("root").style.transform = "";
  });
  await expect(nav).toBeVisible();
  box = await nav.boundingBox();
  expect(Math.abs(page.viewportSize().height - box.y - box.height)).toBeLessThan(2);
  await page.screenshot({ path: `screenshots/${info.project.name}/navigation-fixed.png` });
});

test("caught-up section stays hidden when every post was already seen", async ({ page }) => {
  await page.route(/\/feed\?/, (route) => route.fulfill({ headers: {
    "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true",
  }, json: { items: [{ type: "follow", id: "follow-demo", createdAt: new Date().toISOString(),
    follower: { id: "first", username: "mia", displayName: "Mia", avatarKey: null, createdAt: new Date().toISOString() },
    followee: { id: "second", username: "leo", displayName: "Leo", avatarKey: null, createdAt: new Date().toISOString() } }],
    nextCursor: null, caughtUp: true, boundaryIndex: 0 } }));
  await page.goto("/");
  await expect(page.getByText("No more posts.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You're all caught up" })).toHaveCount(0);
});

test("caught-up section appears once only after scrolling through new entries", async ({ page }, info) => {
  const createdAt = new Date().toISOString();
  await page.route(/\/feed\?/, (route) => route.fulfill({ headers: {
    "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true",
  }, json: { items: Array.from({ length: 25 }, (_, index) => ({ type: "follow", id: `follow-${index}`, createdAt,
    follower: { id: "first", username: "mia", displayName: "Mia", avatarKey: null, createdAt },
    followee: { id: "second", username: "leo", displayName: "Leo", avatarKey: null, createdAt } })),
    nextCursor: null, caughtUp: true, boundaryIndex: 20 } }));
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "You're all caught up" });
  await expect(page.getByText("Mia followed", { exact: false }).first()).toBeVisible();
  await expect(heading).not.toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(heading).toBeInViewport();
  await expect(heading).toHaveCount(1);
  await expect(page.getByText("Earlier posts", { exact: true })).toBeVisible();
  await page.screenshot({ path: `screenshots/${info.project.name}/caught-up-section.png` });
});

test("hashtag links open exact, case-insensitive results and preserve private/circle/block permissions", async ({ page, context }, info) => {
  const stamp = Date.now();
  const tag = `lokal${stamp}`;
  const mia = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
  const leo = await database.user.findUniqueOrThrow({ where: { username: "leo" } });
  const ivy = await database.user.findUniqueOrThrow({ where: { username: "ivy" } });
  const caption = `Public topic #${tag} #Grüße https://example.com/#notahashtag`;
  const created = await context.request.post(`${API}/posts`, { data: { text: caption } });
  expect(created.status()).toBe(201);
  const { post } = await created.json();
  const privatePost = await database.post.create({ data: { authorId: mia.id, text: `Hidden #${tag}`, hashtags: [tag], visibility: "circle" } });
  const blockedPost = await database.post.create({ data: { authorId: ivy.id, text: `Blocked #${tag}`, hashtags: [tag], visibility: "public" } });
  const edge = await database.blockedUser.upsert({ where: { blockerId_blockedId: { blockerId: leo.id, blockedId: ivy.id } }, create: { blockerId: leo.id, blockedId: ivy.id }, update: {} });
  try {
    await page.goto(`/post/${post.id}`);
    const link = page.getByRole("link", { name: `#${tag}`, exact: true });
    await expect(link).toBeVisible();
    await expect(page.getByRole("link", { name: "#Grüße", exact: true })).toHaveAttribute("href", "/tags/gr%C3%BC%C3%9Fe");
    await expect(page.locator('a[href="/tags/notahashtag"]')).toHaveCount(0);
    await link.click();
    await expect(page.getByRole("heading", { name: `#${tag}`, exact: true })).toBeVisible();
    await expect(page.getByText(caption, { exact: true })).toBeVisible();
    const response = await context.request.get(`${API}/hashtags/${tag.toUpperCase()}/posts`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.posts.map((item) => item.id)).toContain(post.id);
    expect(data.posts.map((item) => item.id)).not.toContain(privatePost.id);
    expect(data.posts.map((item) => item.id)).not.toContain(blockedPost.id);
    await page.screenshot({ path: `screenshots/${info.project.name}/hashtag-feed.png` });
  } finally {
    await database.blockedUser.delete({ where: { id: edge.id } });
    await database.post.deleteMany({ where: { id: { in: [post.id, privatePost.id, blockedPost.id] } } });
  }
});