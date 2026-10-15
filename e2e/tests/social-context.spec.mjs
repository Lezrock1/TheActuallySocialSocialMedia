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
        window.__testCameraCanvas = canvas;
        canvas.width = 320; canvas.height = 240;
        const paint = canvas.getContext("2d");
        paint.fillStyle = "#ff0000"; paint.fillRect(0, 0, 160, 240);
        paint.fillStyle = "#0000ff"; paint.fillRect(160, 0, 160, 240);
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

test("Snap quick replies keep an encrypted thumbnail and identify the source in chat", async ({ browser, context }, info) => {
  const mia = await friend(browser);
  try {
    await prepare(mia, "mia");
    const page = await prepare(context, "leo");
    const imageKey = await uploadImage(mia);
    const created = await mia.request.post(`${API}/snaps`, { data: { imageKey, text: "A private Snap", recipientUsernames: ["leo"] } });
    expect(created.status()).toBe(201);
    const { snapId } = await created.json();
    await page.goto("/snaps");
    const homeScreenPrompt = page.getByRole("button", { name: "Got it", exact: true });
    if (await homeScreenPrompt.isVisible().catch(() => false)) await homeScreenPrompt.click();
    await page.getByRole("region", { name: "Received Snaps" }).getByRole("button", { name: /New Snap/ }).first().click();
    const snap = page.getByRole("dialog", { name: "Snap from @mia" });
    await expect(snap).toBeVisible();
    await snap.getByPlaceholder("Quick reply").fill("This is my Snap reply");
    await snap.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("This is my Snap reply");
    await expect(page.getByText("Replying to Snap", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const conversationId = new URL(page.url()).searchParams.get("conversation");
    expect(conversationId).toBeTruthy();
    const preview = page.locator(`[data-snap-id="${snapId}"] img`);
    const replyCard = page.locator(`[data-snap-id="${snapId}"]`);
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(replyCard.getByText("Snap reply", { exact: true })).toBeVisible();
    await expect(replyCard).toContainText("@mia");
    await expect(page.getByText("This is my Snap reply", { exact: true })).toBeVisible();
    const messages = (await (await context.request.get(`${API}/conversations/${conversationId}/messages`)).json()).messages;
    const reply = messages.find((message) => message.mediaKey);
    expect(reply?.isEncrypted).toBe(true);
    expect(reply?.mediaKey).toBeTruthy();
    await page.screenshot({ path: `screenshots/${info.project.name}/snap-reply-context.png` });
  } finally {
    await mia.close();
  }
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
    if (type === "video") {
      await expect(sender.getByLabel("Your camera preview", { exact: true })).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
      await expect(recipient.getByLabel("Your camera preview", { exact: true })).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
      await expect(sender.getByLabel("Participant camera", { exact: true })).toHaveCSS("transform", "none");
      await sender.getByRole("button", { name: "Camera off", exact: true }).click();
      await expect(sender.getByLabel("Your camera preview", { exact: true })).toHaveCount(0);
      await sender.getByRole("button", { name: "Camera on", exact: true }).click();
      await expect(sender.getByLabel("Your camera preview", { exact: true })).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
    }
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

for (const facing of ["environment", "user"]) {
  test(`${facing} camera mirrors its preview, photo pixels and recorded video pixels`, async ({ context }, info) => {
    test.skip(info.project.name !== "android", "WebKit does not start synthetic canvas camera streams in this test environment");
    const page = await prepare(context, "leo");
    await page.getByRole("button", { name: "Open camera", exact: true }).click();
    const shutter = page.getByRole("button", { name: "Take photo, or hold to record video", exact: true });
    await expect(shutter).toBeEnabled();
    if (facing === "user") {
      await page.getByRole("button", { name: "Switch to front camera", exact: true }).click();
      await expect(shutter).toBeEnabled();
    }
    const preview = page.getByLabel("Camera preview", { exact: true });
    await expect(preview).toHaveCSS("transform", facing === "user" ? "matrix(-1, 0, 0, 1, 0, 0)" : "matrix(1, 0, 0, 1, 0, 0)");
    await shutter.click();
    const photo = page.getByRole("img", { name: "Photo preview", exact: true });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    const checkPixels = (media) => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
      const paint = canvas.getContext("2d"); paint.drawImage(media, 0, 0, 320, 240);
      return [Array.from(paint.getImageData(80, 120, 1, 1).data), Array.from(paint.getImageData(240, 120, 1, 1).data)];
    };
    const [left, right] = await photo.evaluate(checkPixels);
    const [leftPrimary, rightPrimary] = facing === "user" ? [left, right] : [right, left];
    expect(leftPrimary[2]).toBeGreaterThan(200); expect(leftPrimary[0]).toBeLessThan(50);
    expect(rightPrimary[0]).toBeGreaterThan(200); expect(rightPrimary[2]).toBeLessThan(50);
    if (info.project.name === "android") {
      await page.getByRole("button", { name: "Retake", exact: true }).click();
      await expect(shutter).toBeEnabled();
      if (facing === "user") {
        await page.getByRole("button", { name: "Switch to front camera", exact: true }).click();
        await expect(shutter).toBeEnabled();
      }
      await shutter.hover(); await page.mouse.down();
      await expect(page.getByRole("button", { name: "Recording video", exact: true })).toBeVisible();
      const startedAt = Date.now();
      await expect.poll(() => Date.now() - startedAt).toBeGreaterThan(1200);
      await page.mouse.up();
      const clip = page.locator("video[src^='blob:']");
      await expect(clip).toBeVisible();
      await expect.poll(() => clip.evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
      const [videoLeft, videoRight] = await clip.evaluate(checkPixels);
      const [videoLeftPrimary, videoRightPrimary] = facing === "user" ? [videoLeft, videoRight] : [videoRight, videoLeft];
      expect(videoLeftPrimary[2]).toBeGreaterThan(180); expect(videoLeftPrimary[0]).toBeLessThan(70);
      expect(videoRightPrimary[0]).toBeGreaterThan(180); expect(videoRightPrimary[2]).toBeLessThan(70);
    }
  });
}

test("mirrored security scanner still verifies an unchanged QR payload", async ({ browser, context }, info) => {
  test.skip(info.project.name !== "android", "Requires synthetic canvas media streams");
  const mia = await friend(browser);
  try {
    await prepare(mia, "mia");
    const page = await prepare(context, "leo");
    const conversationId = (await (await context.request.post(`${API}/conversations`, { data: { username: "mia" } })).json()).conversationId;
    await page.goto(`/dms?conversation=${conversationId}`);
    await page.getByRole("button", { name: "Security code", exact: true }).click();
    const qr = page.getByRole("img", { name: "Security code QR", exact: true });
    await expect(qr).toBeVisible();
    const source = await qr.getAttribute("src");
    await page.getByRole("button", { name: "Scan their QR code", exact: true }).click();
    const scanner = page.getByLabel("QR camera preview", { exact: true });
    await expect(scanner).toHaveCSS("transform", "none");
    await expect.poll(() => scanner.evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
    const decoded = await page.evaluate(async (source) => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = window.__testCameraCanvas;
      const paint = canvas.getContext("2d");
      paint.fillStyle = "white"; paint.fillRect(0, 0, canvas.width, canvas.height);
      paint.drawImage(image, 40, 0, 240, 240);
      const { default: jsQR } = await import("/node_modules/.vite/deps/jsqr.js");
      const pixels = paint.getImageData(0, 0, canvas.width, canvas.height);
      const redraw = () => {
        paint.drawImage(image, 40, 0, 240, 240);
        requestAnimationFrame(redraw);
      };
      redraw();
      return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
    }, source);
    expect(decoded).not.toBeNull();
    await expect(page.getByRole("button", { name: "Remove verification", exact: true })).toBeVisible();
    await expect(scanner).toHaveCount(0);
  } finally {
    await mia.close();
  }
});

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

test("Moments can be saved early, keep friends locked until the drop, and show named reactions", async ({ browser, context }, info) => {
  const mia = await friend(browser);
  const miaPage = await prepare(mia, "mia");
  const page = await prepare(context, "leo");
  const today = new Date().toISOString().slice(0, 10);
  const moment = await database.moment.upsert({ where: { day: today }, create: { day: today, startsAt: new Date(Date.now() + 10 * 60_000) }, update: { startsAt: new Date(Date.now() + 10 * 60_000) } });
  const leo = await database.user.findUniqueOrThrow({ where: { username: "leo" } });
  const miaUser = await database.user.findUniqueOrThrow({ where: { username: "mia" } });
  await database.momentPost.deleteMany({ where: { momentId: moment.id } });
  const imageKey = await uploadImage(mia);
  const miaPost = await database.momentPost.create({ data: { momentId: moment.id, userId: miaUser.id, imageKey } });
  expect((await context.request.post(`${API}/moments/posts/${miaPost.id}/reactions`, { data: { emoji: "🔥" } })).status()).toBe(404);
  expect((await context.request.get(`${API}/moments/today/feed`)).status()).toBe(200);
  expect((await (await context.request.get(`${API}/moments/today/feed`)).json()).posts).toHaveLength(0);
  await page.goto("/");
  await page.getByRole("button", { name: "Create Today's Moment" }).click();
  await expect(page.getByRole("button", { name: "Close camera", exact: true })).toBeVisible();
  await page.locator("#camera-file-picker").setInputFiles({
    name: "early-moment.png", mimeType: "image/png",
    buffer: await readFile(new URL("../../apps/web/public/apple-touch-icon.png", import.meta.url)),
  });
  await page.getByRole("button", { name: "Share Moment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Today's Moment" })).toBeVisible();
  const earlySummary = await (await context.request.get(`${API}/moments/today`)).json();
  expect(earlySummary.status).toBe("waiting");
  expect(earlySummary.myPost.early).toBe(true);
  const waitingFeed = await (await context.request.get(`${API}/moments/today/feed`)).json();
  expect(waitingFeed.posts.map((post) => post.user.username)).toEqual(["leo"]);
  await page.getByRole("button", { name: "Open Today's Moment" }).click();
  await expect(page.getByText("Saved early", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next Moment" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close Moment", exact: true }).click();
  await database.moment.update({ where: { id: moment.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
  await page.reload();
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