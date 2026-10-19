import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PrismaClient } from "../../apps/api/node_modules/@prisma/client/default.js";
import { API } from "../seed.mjs";

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

test("Chats offer compact rows, working filters, pins and responsive split view", async ({ page, context }, info) => {
  const response = await context.request.post(`${API}/conversations`, { data: { username: "mia" } });
  const { conversationId } = await response.json();
  await page.goto("/dms");
  await expect(page.getByRole("heading", { name: "Chats", exact: true })).toBeVisible();
  const row = page.locator(`[data-conversation-id="${conversationId}"]`);
  await expect(row).toBeVisible();
  const pin = row.getByRole("button", { name: "Pin chat", exact: true });
  if (await pin.count()) await pin.click();
  await page.getByRole("button", { name: "Pinned", exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByLabel("Search chats", { exact: true }).fill("no-such-person");
  await expect(page.getByText("No chats found.", { exact: true })).toBeVisible();
  await page.getByLabel("Search chats", { exact: true }).fill("");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.screenshot({ path: `screenshots/${info.project.name}/chats-mobile.png`, fullPage: true, animations: "disabled" });
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

test("friends follow activity is paginated on Alerts and never enters the post feed", async ({ page, context }) => {
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
  } finally { await database.user.deleteMany({ where: { username: { in: usernames } } }); }
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
  await page.getByRole("tab", { name: /New Snaps/ }).click();
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

test("Story rings persist only completed views and reopen at the first unseen Story", async ({ browser, page, context }) => {
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
    await page.getByRole("button", { name: "Close stories" }).click();
    let groups = (await (await context.request.get(`${API}/stories`)).json()).groups;
    expect(groups.flatMap((group) => group.stories).find((story) => story.id === first.id).viewedAt).toBeNull();
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
    await ring.click();
    const latest = (await (await context.request.get(`${API}/stories`)).json()).groups.find((group) => group.author.username === "mia");
    const expectedIndex = latest.stories.findIndex((story) => !story.viewedAt);
    await expect(dialog.getByRole("img", { name: `Story ${expectedIndex + 1} from @mia`, exact: true })).toBeVisible();
    expect(latest.stories.find((story) => story.id === second.id).viewedAt).toBeNull();
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
    await page.goto(`/?story=${first.id}`);
    const other = await otherDevice.newPage(); await other.goto("/");
    await expect.poll(() => other.evaluate(async () => (await import("/src/lib/socket.ts")).getSocket().connected)).toBe(true);
    await expect(page.getByRole("dialog", { name: "Stories from @mia" }).getByRole("img", { name: /^Story/ })).toBeVisible();
    let failedWrites = 0;
    const viewUrl = `**/stories/${first.id}/view`;
    await page.route(viewUrl, (route) => { failedWrites++; return route.abort("failed"); });
    await page.clock.fastForward(7500);
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

test("camera startup coalesces visibility restarts and releases a late permission after close", async ({ page }) => {
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
    let calls = 0;
    const makeStream = () => {
      const track = { readyState: "live", stop() { this.readyState = "ended"; } };
      return { getTracks: () => [track], clone: makeStream };
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