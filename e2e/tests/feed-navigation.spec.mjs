import { test, expect } from "@playwright/test";
import { PrismaClient } from "../../apps/api/node_modules/@prisma/client/default.js";
import { API } from "../seed.mjs";

const database = new PrismaClient({ datasourceUrl: "postgresql://app:app@localhost:5432/e2e" });
test.afterAll(() => database.$disconnect());
test.beforeEach(async ({ context }, info) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${info.testId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 240 + 1}` });
  await context.request.post(`${API}/users/me/update-notice/acknowledge`);
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

test("caught-up section appears once and separates earlier posts", async ({ page }, info) => {
  await page.route(/\/feed\?/, (route) => route.fulfill({ headers: {
    "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true",
  }, json: { items: [{ type: "follow", id: "follow-demo", createdAt: new Date().toISOString(),
    follower: { id: "first", username: "mia", displayName: "Mia", avatarKey: null, createdAt: new Date().toISOString() },
    followee: { id: "second", username: "leo", displayName: "Leo", avatarKey: null, createdAt: new Date().toISOString() } }],
    nextCursor: null, caughtUp: true, boundaryIndex: 0 } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You're all caught up" })).toHaveCount(1);
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