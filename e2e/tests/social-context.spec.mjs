import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "../../apps/api/node_modules/@prisma/client/default.js";
import { API } from "../seed.mjs";

const database = new PrismaClient({ datasourceUrl: "postgresql://app:app@localhost:5432/e2e" });
test.afterAll(async () => database.$disconnect());
test.beforeEach(async ({ context }, info) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${info.testId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 240 + 1}` });
  await database.message.deleteMany();
  await database.encryptionKey.deleteMany();
});

async function prepare(context, username) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async (constraints) => {
      const stream = new MediaStream();
      if (constraints.audio) {
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        const oscillator = audioContext.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        destination.stream.getTracks().forEach((track) => stream.addTrack(track));
      }
      if (constraints.video) {
        const canvas = document.createElement("canvas");
        canvas.width = 320; canvas.height = 240;
        const paint = canvas.getContext("2d");
        paint.fillStyle = "#14845f"; paint.fillRect(0, 0, 320, 240);
        canvas.captureStream(10).getTracks().forEach((track) => stream.addTrack(track));
      }
      return stream;
    } });
  });
  await context.request.post(`${API}/users/me/update-notice/acknowledge`);
  const page = await context.newPage();
  await page.goto("/dms", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => (await context.request.get(`${API}/users/${username}/encryption-keys`)).json().then((data) => data.keys.length)).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
  return page;
}

async function friend(browser, username = "mia") {
  return browser.newContext({ baseURL: "http://localhost:5173", storageState: `.auth/${username}.json`, permissions: ["camera", "microphone"], extraHTTPHeaders: { "x-forwarded-for": "198.51.100.20" } });
}

async function uploadImage(context) {
  const response = await context.request.post(`${API}/media`, { multipart: {
    file: { name: "story-context.png", mimeType: "image/png", buffer: await readFile(new URL("../../apps/web/public/apple-touch-icon.png", import.meta.url)) },
  } });
  expect(response.status()).toBe(201);
  return (await response.json()).key;
}

test("Story reply sends directly and keeps its thumbnail after Story deletion", async ({ browser, context }, info) => {
  const mia = await friend(browser);
  await prepare(mia, "mia");
  const page = await prepare(context, "leo");
  const key = await uploadImage(mia);
  const response = await mia.request.post(`${API}/stories`, { data: { imageKey: key, visibility: "public" } });
  expect(response.status()).toBe(201);
  const storyId = (await response.json()).story.id;
  await page.goto(`/?story=${storyId}`);
  await page.getByPlaceholder("Reply to @mia...").fill("This is a reply with Story context");
  await page.getByRole("dialog", { name: "Stories from @mia" }).getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByText("This is a reply with Story context", { exact: true })).toBeVisible();
  const thumbnail = page.locator(`[data-story-id="${storyId}"] img`);
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await mia.request.delete(`${API}/stories/${storyId}`);
  await page.reload();
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: `screenshots/${info.project.name}/story-reply-context.png` });
  await mia.close();
});

for (const type of ["audio", "video"]) {
  test(`${type} call reaches the Feed and records completed duration and notification`, async ({ browser, context }, info) => {
    test.skip(info.project.name !== "android", "Chromium provides fake media devices");
    const mia = await friend(browser);
    const recipient = await prepare(mia, "mia");
    const sender = await prepare(context, "leo");
    const result = await context.request.post(`${API}/conversations`, { data: { username: "mia" } });
    const conversationId = (await result.json()).conversationId;
    await sender.goto(`/dms?conversation=${conversationId}`);
    await recipient.goto("/");
    await expect.poll(() => sender.evaluate(async () => (await import("/src/lib/socket.ts")).getSocket().connected)).toBe(true);
    await expect.poll(() => recipient.evaluate(async () => (await import("/src/lib/socket.ts")).getSocket().connected)).toBe(true);
    await sender.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    });
    await sender.getByRole("button", { name: `Start ${type} call` }).click();
    await expect(sender.getByRole("dialog", { name: `${type} call`, exact: true }), await sender.locator("body").innerText()).toBeVisible({ timeout: 15_000 });
    await expect(recipient.getByRole("dialog", { name: "Incoming call" })).toBeVisible();
    await expect(recipient.getByText(`Incoming ${type} call`, { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const response = await mia.request.get(`${API}/notifications`);
      return (await response.json()).notifications.some((item) => item.type === "call" && item.conversationId === conversationId);
    }).toBe(true);
    await recipient.getByRole("button", { name: "Answer", exact: true }).click();
    await expect(recipient.getByRole("dialog", { name: `${type} call`, exact: true })).toBeVisible();
    await recipient.waitForTimeout(1200);
    await recipient.getByLabel("End call", { exact: true }).click();
    await expect(sender.getByRole("dialog", { name: `${type} call`, exact: true })).not.toBeVisible();
    await expect.poll(async () => {
      const rows = (await (await context.request.get(`${API}/conversations/${conversationId}/messages`)).json()).messages;
      const calls = rows.filter((row) => row.callId).map((row) => JSON.parse(row.text));
      return calls.some((call) => call.callType === type && call.status === "completed" && call.durationSeconds >= 1);
    }).toBe(true);
    await expect(sender.getByText(/Duration/).last()).toBeVisible();
    await sender.screenshot({ path: `screenshots/${info.project.name}/${type}-call-history.png` });
    await mia.close();
  });
}

test("A saved call ID cannot overwrite earlier call history", async ({ context }) => {
  const page = await prepare(context, "leo");
  const conversationId = (await (await context.request.post(`${API}/conversations`, { data: { username: "mia" } })).json()).conversationId;
  const conversation = await database.conversation.findUnique({ where: { id: conversationId }, include: { members: { include: { user: true } } } });
  const callId = crypto.randomUUID();
  const text = JSON.stringify({ type: "call", callType: "audio", status: "completed", durationSeconds: 42 });
  const message = await database.message.create({ data: { callId, conversationId, senderId: conversation.members.find((member) => member.user.username === "mia").userId, text } });
  const result = await page.evaluate(async ({ callId, conversationId }) => {
    const { getSocket } = await import("/src/lib/socket.ts");
    return new Promise((resolve) => getSocket().timeout(5000).emit("call:start", { callId, conversationId, callType: "audio" }, (error, response) => resolve(error ? { error: error.message } : response)));
  }, { callId, conversationId });
  expect(result).toEqual({ ok: false, error: "Call ID has already been used" });
  expect((await database.message.findUnique({ where: { id: message.id } })).text).toBe(text);
});

test("Declined and unanswered calls appear in history", async ({ browser, context }, info) => {
  test.skip(info.project.name !== "android", "Requires fake media devices");
  const mia = await friend(browser);
  const recipient = await prepare(mia, "mia");
  const sender = await prepare(context, "leo");
  const conversationId = (await (await context.request.post(`${API}/conversations`, { data: { username: "mia" } })).json()).conversationId;
  await sender.goto(`/dms?conversation=${conversationId}`);
  await recipient.goto("/");
  await sender.getByRole("button", { name: "Start audio call" }).click();
  await expect(sender.getByRole("dialog", { name: "audio call", exact: true }), await sender.locator("body").innerText()).toBeVisible();
  await recipient.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(sender.getByText("Declined call", { exact: true }).last()).toBeVisible();
  const dismiss = sender.getByRole("alertdialog").getByRole("button", { name: "Close", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await sender.getByRole("button", { name: "Start video call" }).click();
  await expect(recipient.getByRole("dialog", { name: "Incoming call" })).toBeVisible();
  await sender.getByLabel("End call", { exact: true }).click();
  await expect(sender.getByText("Missed call", { exact: true }).last()).toBeVisible();
  await expect(recipient.getByRole("dialog", { name: "Incoming call" })).not.toBeVisible();
  await mia.close();
});

test("Unanswered call expires automatically and clears incoming notification", async ({ browser, context }, info) => {
  test.skip(info.project.name !== "android", "Uses synthetic Chromium media streams");
  const mia = await friend(browser);
  const recipient = await prepare(mia, "mia");
  const sender = await prepare(context, "leo");
  const conversationId = (await (await context.request.post(`${API}/conversations`, { data: { username: "mia" } })).json()).conversationId;
  await sender.goto(`/dms?conversation=${conversationId}`);
  await recipient.goto("/");
  await sender.getByRole("button", { name: "Start audio call" }).click();
  await expect(recipient.getByRole("dialog", { name: "Incoming call" })).toBeVisible();
  await expect(recipient.getByRole("dialog", { name: "Incoming call" })).not.toBeVisible({ timeout: 50_000 });
  await expect(sender.getByRole("dialog", { name: "audio call", exact: true })).not.toBeVisible();
  const messages = (await (await context.request.get(`${API}/conversations/${conversationId}/messages`)).json()).messages;
  const latest = messages.filter((message) => message.callId).at(-1);
  await expect.poll(async () => {
    const message = await database.message.findUnique({ where: { id: latest.id } });
    return JSON.parse(message.text).status;
  }).toBe("missed");
  await mia.close();
});

test("Moments show named reactions, support changes/removal and keep the posting lock", async ({ browser, context }, info) => {
  const mia = await friend(browser);
  const miaPage = await prepare(mia, "mia");
  const page = await prepare(context, "leo");
  const today = new Date().toISOString().slice(0, 10);
  const moment = await database.moment.upsert({ where: { day: today }, create: { day: today, startsAt: new Date(Date.now() - 60_000) }, update: { startsAt: new Date(Date.now() - 60_000) } });
  const leo = await database.user.findUniqueOrThrow({ where: { username: "leo" } });
  const miaUser = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
  await database.momentPost.deleteMany({ where: { momentId: moment.id } });
  const imageKey = await uploadImage(mia);
  const miaPost = await database.momentPost.create({ data: { momentId: moment.id, userId: miaUser.id, imageKey } });
  expect((await context.request.post(`${API}/moments/posts/${miaPost.id}/reactions`, { data: { emoji: "🔥" } })).status()).toBe(404);
  const ownKey = await uploadImage(context);
  await database.momentPost.create({ data: { momentId: moment.id, userId: leo.id, imageKey: ownKey } });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Today's Moment" }).click();
  await page.getByRole("button", { name: "Next Moment" }).click();
  await page.getByRole("button", { name: "React 🔥", exact: true }).click();
  await expect(page.getByLabel("Moment reactions")).toContainText("@leo 🔥");
  await page.getByRole("button", { name: "React 😂", exact: true }).click();
  await expect(page.getByLabel("Moment reactions")).toContainText("@leo 😂");
  await expect(page.getByLabel("Moment reactions")).not.toContainText("@leo 🔥");
  await miaPage.goto("/");
  await miaPage.getByRole("button", { name: "Open Today's Moment" }).click();
  await expect(miaPage.getByLabel("Moment reactions")).toContainText("@leo 😂");
  await page.screenshot({ path: `screenshots/${info.project.name}/moment-reactions.png` });
  await page.getByRole("button", { name: "React 😂", exact: true }).click();
  await expect(page.getByLabel("Moment reactions")).not.toContainText("@leo 😂");
  expect((await context.request.post(`${API}/moments/posts/${miaPost.id}/reactions`, { data: { emoji: "invalid" } })).status()).toBe(400);
  await mia.close();
});

test("Music suggestion selection and corrections keep all service links accurate", async ({ context }, info) => {
  await context.request.post(`${API}/users/me/update-notice/acknowledge`);
  const page = await context.newPage();
  const corsHeaders = { "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true" };
  await page.route(/\/music\/search\?/, (route) => route.fulfill({ headers: corsHeaders, json: { tracks: [
    { id: "1", title: "One More Time", artist: "Daft Punk", appleUrl: "https://music.apple.com/us/album/one-more-time/1" },
  ] } }));
  await page.route("**/music/links", (route) => route.fulfill({ headers: corsHeaders, json: { links: {
    spotify: "https://open.spotify.com/track/one", apple_music: "https://music.apple.com/us/album/one-more-time/1", soundcloud: "https://soundcloud.com/daft-punk/one-more-time",
  } } }));
  await page.goto("/u/leo");
  const panel = page.getByRole("region", { name: "Now playing", exact: true });
  await panel.getByRole("button", { name: /Share|Edit/, exact: true }).click();
  await page.getByRole("textbox", { name: "Track title", exact: true }).fill("One More");
  await page.getByRole("option", { name: "One More Time Daft Punk" }).click();
  await expect(page.getByRole("textbox", { name: "Artist", exact: true })).toHaveValue("Daft Punk");
  await expect(page.getByRole("textbox", { name: "Preferred service link", exact: true })).toHaveValue("https://open.spotify.com/track/one");
  await page.getByRole("textbox", { name: "Track title", exact: true }).fill("Corrected Song");
  await expect(page.getByRole("textbox", { name: "Preferred service link", exact: true })).toHaveValue(/search.*Corrected/);
  await page.getByRole("textbox", { name: "Artist", exact: true }).fill("Corrected Artist");
  await expect(page.getByRole("textbox", { name: "Preferred service link", exact: true })).toHaveValue(/Corrected%20Artist.*Corrected%20Song/);
  await panel.getByRole("button", { name: "Share track" }).click();
  await expect(panel.getByRole("link", { name: "Spotify · Search", exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Apple Music · Search", exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "SoundCloud", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `screenshots/${info.project.name}/music-correction.png` });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator("body").evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(width);
  }
});