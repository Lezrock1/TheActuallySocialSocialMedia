import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PrismaClient } from "../../apps/api/node_modules/@prisma/client/default.js";
import { API } from "../seed.mjs";
import { runInNewContext } from "node:vm";

const database = new PrismaClient({ datasourceUrl: "postgresql://app:app@localhost:5432/e2e" });
test.afterAll(() => database.$disconnect());
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 240) + 10}` });
  await context.request.post(`${API}/users/me/update-notice/acknowledge`);
});

async function upload(context) {
  const response = await context.request.post(`${API}/media`, { multipart: { file: { name: "experience.png", mimeType: "image/png", buffer: await readFile(new URL("../../apps/web/public/apple-touch-icon.png", import.meta.url)) } } });
  expect(response.status()).toBe(201);
  return (await response.json()).key;
}

test("dark appearance keeps every main page and settings page free of bright UI surfaces", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("intouch:theme", "dark"));
  const routes = ["/", "/snaps", "/dms", "/notifications", "/people", "/u/leo", "/settings/appearance", "/settings/notifications", "/settings/account", "/settings/security", "/settings/ai", "/circles", "/invitations", "/dashboard"];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("main, h1").first()).toBeVisible();
    const bright = await page.evaluate(() => [...document.querySelectorAll("button, span, div, section, article, a")].filter((element) => {
      if (element.closest('[aria-label="Light"]') || ![...element.classList].some((name) => name.startsWith("bg-"))) return false;
      const bounds = element.getBoundingClientRect();
      if (bounds.width < 14 || bounds.height < 14 || bounds.width * bounds.height < 300 || !element.getClientRects().length) return false;
      const color = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      return color.length >= 3 && (color[3] ?? 1) > 0.9 && color.slice(0, 3).every((channel) => channel > 225);
    }).map((element) => `${element.tagName}.${element.className}`));
    expect(bright, route).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const slug = route.replaceAll("/", "-") || "feed";
    await page.screenshot({ path: `screenshots/${info.project.name}/dark-audit${slug}.png`, animations: "disabled" });
    const mobile = page.viewportSize();
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `screenshots/${info.project.name}/dark-audit-desktop${slug}.png`, animations: "disabled" });
    await page.setViewportSize(mobile);
  }
  const colors = await page.evaluate(() => {
    const group = document.createElement("div");
    group.innerHTML = '<span class="bg-sky-100 text-sky-700">Bluesky</span><button class="bg-emerald-50 text-emerald-700">Reposted</button><span class="bg-violet-100 text-violet-700">Mastodon</span>';
    document.body.append(group);
    const values = [...group.children].map((element) => getComputedStyle(element).backgroundColor);
    group.remove(); return values;
  });
  expect(colors).toEqual(["rgb(23, 51, 63)", "rgb(25, 55, 46)", "rgb(48, 36, 63)"]);
});

test("sunset scheduling survives reload and resume and respects selected time zones", async ({ page, context }, info) => {
  const original = (await (await context.request.get(`${API}/notifications/preferences`)).json()).preferences;
  await page.clock.install({ time: new Date("2026-06-21T00:00:00Z") });
  try {
    await page.goto("/settings/appearance");
    await page.getByLabel("Time zone", { exact: true }).selectOption("Europe/Berlin");
    await page.getByRole("switch", { name: "Sunset to sunrise", exact: true }).click();
    await page.getByLabel("Latitude", { exact: true }).fill("52.52");
    await page.getByLabel("Longitude", { exact: true }).fill("13.405");
    await page.getByRole("button", { name: "Save location", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.getByRole("switch", { name: "Sunset to sunrise", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.clock.setSystemTime(new Date("2026-06-21T12:00:00Z"));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const themes = await page.evaluate(async () => {
      const { resolveScheduledTheme } = await import("/src/lib/theme.ts");
      return [
        resolveScheduledTheme({ mode: "sun", timeZone: "Pacific/Auckland", latitude: -36.85, longitude: 174.76 }, new Date("2026-06-21T00:00:00Z")),
        resolveScheduledTheme({ mode: "sun", timeZone: "America/New_York", latitude: 40.71, longitude: -74.01 }, new Date("2026-06-21T00:00:00Z")),
        resolveScheduledTheme({ mode: "sun", timeZone: "Arctic/Longyearbyen", latitude: 78.22, longitude: 15.65 }, new Date("2026-06-21T12:00:00Z")),
        resolveScheduledTheme({ mode: "sun", timeZone: "Arctic/Longyearbyen", latitude: 78.22, longitude: 15.65 }, new Date("2026-12-21T12:00:00Z")),
      ];
    });
    expect(themes).toEqual(["light", "light", "light", "dark"]);
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Sunset to sunrise", exact: true })).toHaveAttribute("aria-checked", "false");
    await page.getByLabel("Time zone", { exact: true }).selectOption("America/New_York");
    await expect.poll(async () => (await (await context.request.get(`${API}/notifications/preferences`)).json()).preferences.timezone).toBe("America/New_York");
    await page.getByRole("region", { name: "Time and automatic appearance", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `screenshots/${info.project.name}/automatic-appearance.png`, animations: "disabled" });
  } finally { await context.request.patch(`${API}/notifications/preferences`, { data: original }); }
});

test("push subscriptions recover after loss and network failures without overriding Turn off", async ({ page }) => {
  await page.addInitScript(() => {
    window.__pushState = { missing: true, subscribed: 0, prompts: 0, unsubscribed: 0 };
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: async () => { window.__pushState.prompts += 1; return "granted"; } } });
    if (!("PushManager" in window)) Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
    const subscription = { endpoint: "https://example.com/push", toJSON: () => ({ endpoint: "https://example.com/push", keys: { auth: "test", p256dh: "test" } }), unsubscribe: async () => { window.__pushState.missing = true; window.__pushState.unsubscribed += 1; return true; } };
    const registration = { pushManager: {
      getSubscription: async () => window.__pushState.missing ? null : subscription,
      subscribe: async () => { window.__pushState.subscribed += 1; window.__pushState.missing = false; return subscription; },
    } };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => registration, addEventListener() {}, removeEventListener() {} } });
  });
  const headers = { "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,PUT,DELETE", "access-control-allow-headers": "content-type" };
  await page.route(/\/notifications\/push\/config$/, (route) => route.fulfill({ headers, json: { enabled: true, publicKey: "AQID" } }));
  let fail = false;
  await page.route(/\/notifications\/push\/subscription$/, (route) => fail && route.request().method() === "PUT" ? route.abort("internetdisconnected") : route.fulfill({ headers, status: 204 }));
  await page.goto("/");
  const recovered = await page.evaluate(async () => {
    Notification.permission = "granted";
    const { restorePushSubscription } = await import("/src/lib/push.ts");
    return Promise.all([restorePushSubscription(), restorePushSubscription(), restorePushSubscription()]);
  });
  expect(recovered).toEqual([true, true, true]);
  expect(await page.evaluate(() => window.__pushState)).toMatchObject({ subscribed: 1, prompts: 0 });
  fail = true;
  expect(await page.evaluate(async () => { window.__pushState.missing = true; return (await import("/src/lib/push.ts")).restorePushSubscription().catch(() => "offline"); })).toBe("offline");
  fail = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => page.evaluate(() => localStorage.getItem("intouch:push-enabled"))).toBe("true");
  expect(await page.evaluate(async () => (await import("/src/lib/push.ts")).restorePushSubscription())).toBe(true);
  await page.evaluate(async () => (await import("/src/lib/push.ts")).disablePush());
  expect(await page.evaluate(async () => (await import("/src/lib/push.ts")).restorePushSubscription())).toBe(false);
  await page.reload();
  expect(await page.evaluate(async () => { Notification.permission = "granted"; return (await import("/src/lib/push.ts")).restorePushSubscription(); })).toBe(false);
  expect(await page.evaluate(() => window.__pushState.prompts)).toBe(0);
});

test("notification drafts survive background refetch before saving", async ({ page }) => {
  await page.goto("/settings/notifications");
  const checkbox = page.locator("#preference-messages");
  const previous = await checkbox.isChecked();
  await checkbox.setChecked(!previous);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(checkbox).toBeChecked({ checked: !previous });
  await expect(page.getByRole("button", { name: /Save/i })).toBeEnabled();
});

test("Chats offer compact rows, working filters, pins and responsive split view", async ({ page, context }, info) => {
  const response = await context.request.post(`${API}/conversations`, { data: { username: "mia" } });
  const { conversationId } = await response.json();
  await page.route(/\/conversations$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const previews = ["Are we still meeting at the park? I can bring something for everyone.", "See you there!", "Saturday at 3 works for everyone."];
    body.conversations = body.conversations.map((conversation, index) => ({
      ...conversation,
      unreadCount: conversation.id === conversationId ? 2 : 0,
      lastMessage: { id: `preview-${index}`, text: previews[index % previews.length], isEncrypted: false, createdAt: new Date(Date.now() - (index + 1) * 180_000).toISOString() },
    }));
    await route.fulfill({ response, json: body });
  });
  await page.goto("/dms");
  await expect(page.getByRole("heading", { name: "Chats", exact: true })).toBeVisible();
  const row = page.locator(`[data-conversation-id="${conversationId}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByLabel("2 unread messages", { exact: true })).toBeVisible();
  await row.getByLabel("Chat actions", { exact: true }).click();
  const pin = row.getByRole("button", { name: "Pin chat", exact: true });
  if (await pin.count()) await pin.click();
  await page.getByRole("button", { name: "Pinned", exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByLabel("Search chats", { exact: true }).fill("no-such-person");
  await expect(page.getByText("No chats found.", { exact: true })).toBeVisible();
  await page.getByLabel("Search chats", { exact: true }).fill("");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.screenshot({ path: `screenshots/${info.project.name}/chats-mobile.png`, fullPage: true, animations: "disabled" });
  await page.evaluate(async () => (await import("/src/lib/theme.ts")).applyTheme("dark"));
  await page.screenshot({ path: `screenshots/${info.project.name}/chats-mobile-dark.png`, fullPage: true, animations: "disabled" });
  await page.evaluate(async () => (await import("/src/lib/theme.ts")).applyTheme("light"));
  await expect(page.getByRole("tab", { name: "Create a Group", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "New group", exact: true }).click();
  await expect(page.getByPlaceholder("Group name (optional)")).toBeVisible();
  await page.screenshot({ path: `screenshots/${info.project.name}/new-group-mobile.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Close new chat", exact: true }).click();
  await row.getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to Messages", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("region", { name: "No chat selected", exact: true })).toBeVisible();
  await page.screenshot({ path: `screenshots/${info.project.name}/chats-desktop.png`, fullPage: true, animations: "disabled" });
  await row.getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("previous Moment stays accessible until the next drop without allowing early posts", async ({ page, context }, info) => {
  await page.clock.install();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const original = await database.moment.findUnique({ where: { day: today } });
  const originalPrevious = await database.moment.findUnique({ where: { day: yesterday } });
  const current = await database.moment.upsert({ where: { day: today }, create: { day: today, startsAt: new Date(Date.now() + 3600_000) }, update: { startsAt: new Date(Date.now() + 3600_000) } });
  const previous = await database.moment.upsert({ where: { day: yesterday }, create: { day: yesterday, startsAt: new Date(Date.now() - 86_400_000) }, update: {} });
  const leo = await database.user.findUniqueOrThrow({ where: { username: "leo" } });
  const savedPost = await database.momentPost.findUnique({ where: { momentId_userId: { momentId: previous.id, userId: leo.id } } });
  const imageKey = await upload(context);
  const post = await database.momentPost.upsert({ where: { momentId_userId: { momentId: previous.id, userId: leo.id } }, create: { momentId: previous.id, userId: leo.id, imageKey }, update: { imageKey } });
  try {
    const summary = await (await context.request.get(`${API}/moments/today`)).json();
    expect(summary.status).toBe("waiting"); expect(summary.previousMoment).toBe(true); expect(summary.myPost.id).toBe(post.id);
    expect((await context.request.post(`${API}/moments/today/post`, { data: { imageKey } })).status()).toBe(409);
    expect((await context.request.get(`${API}/moments/posts/${post.id}/reactions`)).status()).toBe(200);
    expect((await context.request.get(`${API}/media/${imageKey}`)).status()).toBe(200);
    await page.goto("/");
    await page.getByRole("button", { name: "Open Previous Moment", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Previous Moment", exact: true }).getByRole("img", { name: "Moment from @leo" })).toBeVisible();
    await page.screenshot({ path: `screenshots/${info.project.name}/previous-moment.png`, animations: "disabled" });
    await database.moment.update({ where: { id: current.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    const next = await (await context.request.get(`${API}/moments/today`)).json();
    expect(next.previousMoment).toBe(false); expect(next.momentId).toBe(current.id);
    expect((await context.request.get(`${API}/moments/posts/${post.id}/reactions`)).status()).toBe(404);
    await page.clock.fastForward(21_000);
    await expect(page.getByRole("dialog", { name: "Previous Moment", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Create|Open) Today's Moment$/ })).toBeVisible();
  } finally {
    if (original) await database.moment.update({ where: { id: current.id }, data: { startsAt: original.startsAt } });
    else await database.moment.deleteMany({ where: { id: current.id } });
    if (savedPost) await database.momentPost.update({ where: { id: post.id }, data: { imageKey: savedPost.imageKey } });
    else await database.momentPost.deleteMany({ where: { id: post.id } });
    if (!originalPrevious) await database.moment.deleteMany({ where: { id: previous.id } });
  }
});

test("friends follow activity is paginated on Alerts and never enters the post feed", async ({ page, context }, info) => {
  const mia = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
  const usernames = Array.from({ length: 22 }, (_, index) => `activity${Date.now()}${index}`);
  await database.user.createMany({ data: usernames.map((username) => ({ username, usernameCanonical: username, email: `${username}@example.com`, passwordHash: "test-only-no-login" })) });
  const people = await database.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
  await database.follow.createMany({ data: people.map((person) => ({ followerId: mia.id, followeeId: person.id })) });
  try {
  const feed = await (await context.request.get(`${API}/feed`)).json();
  expect(feed.items.every((item) => item.type === "post")).toBe(true);
  const response = await context.request.get(`${API}/notifications/friends-activity`);
  expect(response.status()).toBe(200);
  const activity = await response.json();
  expect(activity.activities.length).toBeGreaterThan(0);
  expect(activity.nextCursor).toBeTruthy();
  const next = await (await context.request.get(`${API}/notifications/friends-activity?cursor=${encodeURIComponent(activity.nextCursor)}`)).json();
  expect(next.activities.length).toBeGreaterThan(0);
  expect(next.activities.every((item) => !activity.activities.some((previous) => previous.id === item.id))).toBe(true);
  expect(activity.activities.every((item) => item.type === "follow" && item.follower.username !== "leo")).toBe(true);
  await page.goto("/notifications");
  await page.getByRole("button", { name: "Your friends activity", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your friends activity" }).getByText("followed", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more activity", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Filter alerts", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  const unread = page.getByRole("switch", { name: "Unread only", exact: true });
  await expect(unread).toBeVisible();
  await unread.click();
  await expect(unread).toBeChecked();
  await expect(page.getByRole("button", { name: /^Direct/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `screenshots/${info.project.name}/alerts-controls.png`, animations: "disabled" });
  } finally { await database.user.deleteMany({ where: { username: { in: usernames } } }); }
});

test("notification center clears completed tags without showing another notification", async () => {
  const handlers = {};
  let displayed = 0;
  const closed = [];
  const source = await readFile(new URL("../../apps/web/public/sw.js", import.meta.url), "utf8");
  const notifications = ["completed", "active", "moment", "quiet-hours-digest"].map((tag) => ({ tag, close: () => closed.push(tag) }));
  runInNewContext(source, { URL, self: { location: { origin: "http://localhost:5173" }, addEventListener: (type, handler) => { handlers[type] = handler; }, registration: { getNotifications: async () => notifications, showNotification: async () => { displayed++; } } } });
  let pending;
  handlers.push({ data: { json: () => ({ type: "notifications:clear", tags: ["completed"] }) }, waitUntil: (promise) => { pending = promise; } });
  await pending;
  expect(closed).toEqual(["completed"]);
  expect(displayed).toBe(0);
  closed.length = 0;
  handlers.message({ data: { type: "notifications:sync", tags: ["active"] }, waitUntil: (promise) => { pending = promise; } });
  await pending;
  expect(closed).toEqual(["completed"]);
  closed.length = 0;
  handlers.message({ data: { type: "notifications:sync", tags: [] }, waitUntil: (promise) => { pending = promise; } });
  await pending;
  expect(closed).toEqual(["completed", "active", "quiet-hours-digest"]);
});

test("Story alerts include emoji, respect ownership and disappear after completion", async ({ browser, page, context }) => {
  const mia = await browser.newContext({ baseURL: "http://localhost:5173", storageState: ".auth/mia.json", serviceWorkers: "block" });
  const imageKey = await upload(context);
  const created = await context.request.post(`${API}/stories`, { data: { imageKey } });
  expect(created.status()).toBe(201);
  const { story } = await created.json();
  let notificationId;
  try {
    expect((await mia.request.post(`${API}/stories/${story.id}/reactions`, { data: { emoji: "🔥" } })).ok()).toBe(true);
    const notification = await database.notification.findFirstOrThrow({ where: { storyId: story.id, type: "story_reaction" } });
    notificationId = notification.id;
    expect(notification.reactionEmoji).toBe("🔥");
    await mia.request.post(`${API}/notifications/${notification.id}/read`);
    expect((await database.notification.findUniqueOrThrow({ where: { id: notification.id } })).dismissedAt).toBeNull();
    await page.goto("/notifications");
    const alert = page.locator(`[data-notification-id="${notification.id}"]`);
    await expect(alert).toContainText("reacted to your story 🔥");
    await alert.click();
    await expect.poll(async () => (await database.notification.findUniqueOrThrow({ where: { id: notification.id } })).dismissedAt).toBeTruthy();
    await page.goto("/notifications");
    await expect(alert).toHaveCount(0);
    await page.reload();
    await expect(alert).toHaveCount(0);
  } finally {
    if (notificationId) await database.notification.deleteMany({ where: { id: notificationId } });
    await context.request.delete(`${API}/stories/${story.id}`);
    await mia.close();
  }
});

test("Alerts unread toggle keeps read and completed states distinct", async ({ page }) => {
  const leo = await database.user.findUniqueOrThrow({ where: { username: "leo" } });
  const mia = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
  const notification = await database.notification.create({ data: { recipientId: leo.id, actorId: mia.id, type: "follow", dedupeKey: `read-filter-${Date.now()}`, readAt: new Date() } });
  try {
    await page.goto("/notifications");
    const alert = page.locator(`[data-notification-id="${notification.id}"]`);
    await expect(alert).toBeVisible();
    await page.getByRole("switch", { name: "Unread only" }).click();
    await expect(alert).toHaveCount(0);
    await page.getByRole("switch", { name: "Unread only" }).click();
    await expect(alert).toBeVisible();
    await alert.click();
    await expect.poll(async () => (await database.notification.findUniqueOrThrow({ where: { id: notification.id } })).dismissedAt).toBeTruthy();
  } finally { await database.notification.deleteMany({ where: { id: notification.id } }); }
});

test("Snap friends support unread and streak filters, search and direct chat", async ({ page, context }, info) => {
  const mia = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
  const imageKey = await upload(context);
  const headers = { "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true" };
  const friend = { id: mia.id, username: mia.username, displayName: mia.displayName, avatarKey: mia.avatarKey, createdAt: mia.createdAt.toISOString() };
  await page.route(/\/snaps\/inbox$/, (route) => route.fulfill({ headers, json: { snaps: [{ id: "list-snap", sender: friend, imageKey, text: null, isEncrypted: false, createdAt: new Date().toISOString(), viewedAt: null }], recentlyViewed: [] } }));
  await page.route(/\/snaps\/streaks$/, (route) => route.fulfill({ headers, json: { streaks: [{ friend, currentStreak: 4, bestStreak: 6, waitingForYou: true, waitingForThem: false, lastExchangeAt: new Date().toISOString() }] } }));
  await page.goto("/snaps");
  const list = page.getByRole("region", { name: "Received Snaps" });
  await expect(list.getByRole("heading", { name: "Friends", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Search Snap friends")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("tab", { name: /New Snaps/ }).click();
  await expect(page.getByRole("tab", { name: /New Snaps/ })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByRole("tab", { name: /New Snaps/ })).toHaveCSS("border-bottom-color", "rgb(255, 252, 0)");
  await expect(page.getByRole("tab", { name: /New Snaps/ })).toHaveCSS("color", "rgb(17, 24, 39)");
  await expect(list.getByRole("button", { name: /New Snap/ })).toHaveCount(1);
  await page.getByLabel("Search Snap friends").fill("not-a-friend");
  await expect(list.getByText("No matching friends.", { exact: true })).toBeVisible();
  await page.getByLabel("Search Snap friends").fill("");
  await page.getByRole("tab", { name: "Streaks", exact: true }).click();
  await expect(list).toContainText("4");
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(list.getByRole("button", { name: "Send a Snap to @mia", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `screenshots/${info.project.name}/snap-friends-mobile.png`, fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `screenshots/${info.project.name}/snap-friends-desktop.png`, fullPage: true, animations: "disabled" });
  await list.getByRole("button", { name: "Chat with @mia", exact: true }).click();
  await expect(page).toHaveURL(/\/dms\?conversation=/);
});

test("feed music controls preserve the post draft and expose all music features", async ({ page }, info) => {
  await page.goto("/");
  const draft = page.locator("textarea").first();
  await draft.fill("Keep this post draft while choosing music");
  const musicButton = page.getByRole("button", { name: "Open music", exact: true });
  const order = await musicButton.evaluate((button) => {
    const photo = button.previousElementSibling;
    const post = button.nextElementSibling;
    return { photo: photo?.getAttribute("aria-label"), post: post?.getAttribute("type") };
  });
  expect(order).toEqual({ photo: "Add photo or video", post: "submit" });
  await musicButton.click();
  const music = page.getByRole("dialog", { name: "Music", exact: true });
  await expect(music).toBeVisible();
  await expect(music.getByRole("region", { name: "Now playing", exact: true })).toBeVisible();
  for (const name of ["Music taste", "Mixes & sets", "Now playing"]) {
    await music.getByRole("tab", { name, exact: true }).click();
    await expect(music.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `screenshots/${info.project.name}/feed-music-controls.png`, animations: "disabled" });
  await music.getByRole("button", { name: "Close", exact: true }).click();
  await expect(music).toHaveCount(0);
  await expect(draft).toHaveValue("Keep this post draft while choosing music");
});

test("Appearance keeps theme stable through color changes, navigation and repeated toggles", async ({ page }, info) => {
  await page.goto("/settings/appearance");
  await page.getByRole("button", { name: "Same on all pages", exact: true }).click();
  for (const theme of ["dark", "light", "dark", "light"]) {
    await page.getByRole("button", { name: theme === "dark" ? "Dark" : "Light", exact: true }).click();
    for (const color of ["#ff0011", "#120033", "#00ff33"]) {
      await page.getByLabel("All pages background color", { exact: true }).fill(color);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const colors = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return { text: root.getPropertyValue("--secondary-text").trim(), surface: root.getPropertyValue("--surface").trim() };
      });
      const contrast = (first, second) => {
        const lum = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const values = [lum(first), lum(second)].sort((left, right) => right - left);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: `screenshots/${info.project.name}/appearance-${theme}.png`, fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "Feed", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.goto("/settings/appearance");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
});

test("mobile list preferences persist and chat ordering lives in Settings", async ({ page }, info) => {
  await page.goto("/notifications");
  const unread = page.getByRole("switch", { name: "Unread only", exact: true });
  await expect(unread).toHaveAttribute("aria-checked", "false");
  await unread.click();
  await page.reload();
  await expect(unread).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: `screenshots/${info.project.name}/alerts-switch.png`, animations: "disabled" });
  await page.goto("/settings/appearance");
  const ordering = page.getByRole("switch", { name: "Unread first", exact: true });
  await ordering.click();
  await page.reload();
  await expect(ordering).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: `screenshots/${info.project.name}/messages-settings.png`, animations: "disabled" });
  await page.goto("/dms");
  await expect(page.getByRole("button", { name: "Unread first", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("intouch:unread-first"))).toBe("1");
  const messages = page.locator('nav[aria-label="Primary navigation"]:visible').getByRole("link", { name: /Messages/ });
  await expect(messages).toHaveClass(/messages-nav-active/);
  await page.goto("/snaps");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async (theme) => (await import("/src/lib/theme.ts")).applyTheme(theme), theme);
    await expect(page.getByRole("tab", { name: "All", exact: true })).toHaveCSS("color", theme === "light" ? "rgb(17, 24, 39)" : "rgb(236, 238, 243)");
    const snapLink = page.locator('nav[aria-label="Primary navigation"]:visible').getByRole("link", { name: /Snaps/ });
    const accent = theme === "light" ? "rgb(143, 107, 0)" : "rgb(255, 225, 77)";
    await expect(snapLink).toHaveCSS("color", accent);
    await expect(snapLink.locator("svg")).toHaveCSS("color", accent);
    const search = page.getByLabel("Search Snap friends");
    await search.focus();
    await expect(search).toHaveCSS("outline-color", theme === "light" ? "rgb(184, 138, 0)" : "rgb(255, 225, 77)");
    await page.screenshot({ path: `screenshots/${info.project.name}/snaps-contrast-${theme}.png`, animations: "disabled" });
  }
});

test("Alerts omit the caught-up status when no notifications are unread", async ({ page }) => {
  await page.route(/\/notifications\?/, (route) => route.fulfill({
    headers: { "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true" },
    json: { notifications: [], unreadCount: 0, nextCursor: null },
  }));
  await page.goto("/notifications");
  await expect(page.getByText("No notifications yet.", { exact: true })).toBeVisible();
  const controls = page.getByRole("region", { name: "Alert controls", exact: true });
  await expect(controls.getByText("You're all caught up", { exact: true })).toHaveCount(0);
  await expect(controls.getByRole("status")).toHaveCount(0);
});

test("saved dark appearance survives direct message entry and page resume", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("intouch:theme", "dark");
    localStorage.setItem("intouch:page-background-mode", "shared");
    localStorage.setItem("intouch:page-background:all", JSON.stringify({ color: "#123456", imageKey: null }));
  });
  await page.goto("/dms");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("Search chats", { exact: true })).toHaveClass(/app-search/);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#111318");
  await page.goto("/snaps");
  await expect(page.getByLabel("Search Snap friends")).toHaveClass(/app-search/);
  await expect(page.getByLabel("All Snap streaks", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Streaks", exact: true })).toBeVisible();
});

test("Story rings persist as soon as media is viewed and reopen at the first unseen Story", async ({ browser, page, context }) => {
  const mia = await browser.newContext({ baseURL: "http://localhost:5173", storageState: ".auth/mia.json", extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" } });
  const created = [];
  try {
    const imageKey = await upload(mia);
    const createStory = async () => {
      const response = await mia.request.post(`${API}/stories`, { data: { imageKey, visibility: "public" } });
      expect(response.status()).toBe(201);
      const story = (await response.json()).story; created.push(story.id); return story;
    };
    const first = await createStory();
    await page.clock.install();
    await page.goto(`/?story=${first.id}`);
    const dialog = page.getByRole("dialog", { name: "Stories from @mia" });
    await expect(dialog.getByRole("img", { name: /^Story/ })).toBeVisible();
    await expect.poll(async () => {
      const groups = (await (await context.request.get(`${API}/stories`)).json()).groups;
      return groups.flatMap((group) => group.stories).find((story) => story.id === first.id).viewedAt;
    }).toBeTruthy();
    await page.getByRole("button", { name: "Close stories" }).click();
    let groups = (await (await context.request.get(`${API}/stories`)).json()).groups;
    expect(groups.flatMap((group) => group.stories).find((story) => story.id === first.id).viewedAt).toBeTruthy();
    await page.goto(`/?story=${first.id}`);
    await expect(dialog.getByRole("img", { name: /^Story/ })).toBeVisible();
    await page.clock.fastForward(7500);
    await expect.poll(async () => {
      groups = (await (await context.request.get(`${API}/stories`)).json()).groups;
      return groups.flatMap((group) => group.stories).find((story) => story.id === first.id).viewedAt;
    }).toBeTruthy();
    const second = await createStory();
    await page.reload();
    const ring = page.getByRole("button", { name: "Stories from @mia · Unseen stories", exact: true });
    await expect(ring).toBeVisible();
    const latest = (await (await context.request.get(`${API}/stories`)).json()).groups.find((group) => group.author.username === "mia");
    const expectedIndex = latest.stories.findIndex((story) => !story.viewedAt);
    expect(expectedIndex).toBeGreaterThanOrEqual(0);
    await ring.click();
    await expect(dialog.getByRole("img", { name: `Story ${expectedIndex + 1} from @mia`, exact: true })).toBeVisible();
  } finally {
    for (const id of created) await mia.request.delete(`${API}/stories/${id}`);
    await mia.close();
  }
});

test("Story rings survive failed saves and refresh, synchronize devices and reveal new uploads live", async ({ browser, page, context }) => {
  const mia = await browser.newContext({ baseURL: "http://localhost:5173", storageState: ".auth/mia.json", extraHTTPHeaders: { "x-forwarded-for": "198.51.100.78" } });
  const otherDevice = await browser.newContext({ baseURL: "http://localhost:5173", storageState: ".auth/leo.json", serviceWorkers: "block", extraHTTPHeaders: { "x-forwarded-for": "198.51.100.79" } });
  const created = [];
  try {
    const imageKey = await upload(mia);
    const existing = (await (await context.request.get(`${API}/stories`)).json()).groups.find((group) => group.author.username === "mia");
    for (const story of existing?.stories ?? []) await context.request.post(`${API}/stories/${story.id}/view`);
    const create = async () => {
      const response = await mia.request.post(`${API}/stories`, { data: { imageKey } });
      expect(response.status()).toBe(201);
      const story = (await response.json()).story; created.push(story.id); return story;
    };
    const first = await create();
    await page.clock.install();
    let failedWrites = 0;
    const viewUrl = `**/stories/${first.id}/view`;
    await page.route(viewUrl, (route) => { failedWrites++; return route.abort("failed"); });
    await page.goto(`/?story=${first.id}`);
    const other = await otherDevice.newPage(); await other.goto("/");
    await expect.poll(() => other.evaluate(async () => (await import("/src/lib/socket.ts")).getSocket().connected)).toBe(true);
    await expect(page.getByRole("dialog", { name: "Stories from @mia" }).getByRole("img", { name: /^Story/ })).toBeVisible();
    await expect.poll(() => failedWrites).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Stories from @mia · All seen", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Stories from @mia · All seen", exact: true })).toBeVisible();
    await page.unroute(viewUrl);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => {
      const groups = (await (await context.request.get(`${API}/stories`)).json()).groups;
      return groups.flatMap((group) => group.stories).find((story) => story.id === first.id)?.viewedAt;
    }).toBeTruthy();
    await expect(other.getByRole("button", { name: "Stories from @mia · All seen", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await import("/src/lib/socket.ts")).getSocket().connected)).toBe(true);
    await create();
    await expect(page.getByRole("button", { name: "Stories from @mia · Unseen stories", exact: true })).toBeVisible();
    await expect(other.getByRole("button", { name: "Stories from @mia · Unseen stories", exact: true })).toBeVisible();
  } finally {
    for (const id of created) await mia.request.delete(`${API}/stories/${id}`);
    await otherDevice.close(); await mia.close();
  }
});

test("camera startup coalesces visibility restarts and releases a late permission after close", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "WebKit does not allow overriding its native camera permission prompt");
  await page.addInitScript(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    const tracks = [];
    const makeStream = () => {
      const track = { readyState: "live", stop() { this.readyState = "ended"; } };
      tracks.push(track);
      return { getTracks: () => [track], getVideoTracks: () => [track], clone: makeStream };
    };
    window.__permissionTest = { calls: 0, grant: null, tracks };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: () => {
      window.__permissionTest.calls++;
      return new Promise((resolve) => { window.__permissionTest.grant = () => resolve(makeStream()); });
    } });
  });
  await page.goto("/");
  await page.bringToFront();
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close camera", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__permissionTest.calls)).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "Close camera", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close camera", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__permissionTest.grant());
  await expect.poll(() => page.evaluate(() => window.__permissionTest.tracks.filter((track) => track.readyState === "live").length)).toBe(0);
  expect(await page.evaluate(() => window.__permissionTest.calls)).toBe(1);
});

test("invites last thirty days and consumed links are not falsely reported as expired", async ({ context }) => {
  const response = await context.request.post(`${API}/invitations`);
  expect(response.status()).toBe(201);
  const invitation = await response.json();
  expect(Date.parse(invitation.expiresAt) - Date.now()).toBeGreaterThan(29.9 * 86_400_000);
  const tokenHash = createHash("sha256").update(invitation.code).digest("hex");
  const usernames = [];
  try {
    await database.invitation.update({ where: { tokenHash }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    for (let index = 0; index < 5; index++) {
      const username = `invite${Date.now()}${index}`; usernames.push(username);
      const registration = await context.request.post(`${API}/auth/register`, { data: { username, email: `${username}@example.com`, password: "Passw0rd!e2e", inviteCode: invitation.code } });
      expect(registration.status()).toBe(201);
    }
    const used = await context.request.post(`${API}/auth/register`, { data: { username: `extra${Date.now()}`, email: `extra${Date.now()}@example.com`, password: "Passw0rd!e2e", inviteCode: invitation.code } });
    expect(used.status()).toBe(400);
    expect((await used.json()).error).toContain("already been used 5 times");
  } finally {
    await database.user.deleteMany({ where: { username: { in: usernames } } });
    await database.invitation.deleteMany({ where: { tokenHash } });
  }
});

test("invite link retains its code on refresh", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://localhost:5173", serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const code = "refresh-safe-invitation-code-1234567890";
    await page.goto(`/register#invite=${code}`);
    await expect(page.getByPlaceholder("Invitation code", { exact: true })).toHaveValue(code);
    await page.reload();
    await expect(page.getByPlaceholder("Invitation code", { exact: true })).toHaveValue(code);
  } finally { await context.close(); }
});

test("equivalent media requests reuse an active source but request again after every consumer stops", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { requestUserMedia } = await import("/src/lib/mediaPermissions.ts");
    class TestMediaStream {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
      clone() { return new TestMediaStream(this.tracks.map((track) => track.clone())); }
    }
    Object.defineProperty(window, "MediaStream", { configurable: true, value: TestMediaStream });
    let calls = 0;
    const makeTrack = () => {
      let readyState = "live";
      return { kind: "audio", get readyState() { return readyState; }, stop() { readyState = "ended"; }, clone: makeTrack };
    };
    const makeStream = () => {
      return new TestMediaStream([makeTrack()]);
    };
    navigator.mediaDevices.getUserMedia = async () => { calls++; return makeStream(); };
    const first = await requestUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } });
    const second = await requestUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true } });
    const during = calls;
    first.getTracks().forEach((track) => track.stop());
    const third = await requestUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    const afterFirstStopped = calls;
    second.getTracks().forEach((track) => track.stop());
    third.getTracks().forEach((track) => track.stop());
    const fresh = await requestUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    fresh.getTracks().forEach((track) => track.stop());
    return { during, afterFirstStopped, afterAllStopped: calls };
  });
  expect(result).toEqual({ during: 1, afterFirstStopped: 1, afterAllStopped: 2 });
});

test("simultaneous media requests prompt only once and do not retain active hardware", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { requestUserMedia } = await import("/src/lib/mediaPermissions.ts");
    class TestMediaStream {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
    }
    Object.defineProperty(window, "MediaStream", { configurable: true, value: TestMediaStream });
    let count = 0, sourceStops = 0;
    const cloneStops = [];
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    navigator.mediaDevices.getUserMedia = async () => { count++; return pending; };
    const first = requestUserMedia({ audio: true });
    const second = requestUserMedia({ audio: true });
    resolve({ getTracks: () => [{ stop: () => { sourceStops++; } }], clone: () => { const id = cloneStops.length; cloneStops.push(0); return { getTracks: () => [{ stop: () => { cloneStops[id]++; } }] }; } });
    const streams = await Promise.all([first, second]);
    await Promise.resolve();
    streams[0].getTracks().forEach((track) => track.stop());
    const before = [...cloneStops];
    streams[1].getTracks().forEach((track) => track.stop());
    return { count, sourceStops, before, after: cloneStops };
  });
  expect(result).toEqual({ count: 1, sourceStops: 1, before: [1, 0], after: [1, 1] });
});

test("media permission sharing reuses compatible tracks across differing constraints", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { requestUserMedia } = await import("/src/lib/mediaPermissions.ts");
    const makeTrack = (kind) => {
      let readyState = "live";
      return { kind, get readyState() { return readyState; }, stop() { readyState = "ended"; }, clone: () => makeTrack(kind) };
    };
    class TestMediaStream {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
      clone() { return new TestMediaStream(this.tracks.map((track) => track.clone())); }
    }
    Object.defineProperty(window, "MediaStream", { configurable: true, value: TestMediaStream });
    let calls = 0;
    const requested = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      calls++;
      requested.push(constraints);
      return new TestMediaStream([...(constraints.audio ? [makeTrack("audio")] : []), ...(constraints.video ? [makeTrack("video")] : [])]);
    };
    const first = await requestUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 } } });
    const second = await requestUserMedia({ audio: true, video: { facingMode: "user", width: { ideal: 640 } } });
    const sharedCamera = { calls, request: requested[1], tracks: second.getTracks().map((track) => track.kind) };
    const third = await requestUserMedia({ audio: true, video: { facingMode: "environment" } });
    const differentCamera = { calls, request: requested[2], tracks: third.getTracks().map((track) => track.kind) };
    first.getTracks().forEach((track) => track.stop());
    second.getTracks().forEach((track) => track.stop());
    third.getTracks().forEach((track) => track.stop());
    const fresh = await requestUserMedia({ audio: false, video: { facingMode: "user" } });
    fresh.getTracks().forEach((track) => track.stop());
    return { sharedCamera, differentCamera, afterAllStopped: calls };
  });
  expect(result).toEqual({
    sharedCamera: { calls: 2, request: { audio: true, video: false }, tracks: ["video", "audio"] },
    differentCamera: { calls: 3, request: { audio: false, video: { facingMode: "environment" } }, tracks: ["audio", "video"] },
    afterAllStopped: 4,
  });
});