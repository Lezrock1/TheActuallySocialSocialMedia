import { test, expect } from "@playwright/test";
import { PrismaClient } from "../../apps/api/node_modules/@prisma/client/default.js";
import { API } from "../seed.mjs";

const database = new PrismaClient({ datasourceUrl: "postgresql://app:app@localhost:5432/e2e" });
test.afterAll(() => database.$disconnect());
test.beforeEach(async ({ context }, info) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${info.testId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 240 + 1}` });
  await context.request.post(`${API}/users/me/update-notice/acknowledge`);
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
  expect(Math.abs(page.viewportSize().height - box.y - box.height)).toBeLessThan(45);
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
  expect(Math.abs(page.viewportSize().height - box.y - box.height)).toBeLessThan(45);
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