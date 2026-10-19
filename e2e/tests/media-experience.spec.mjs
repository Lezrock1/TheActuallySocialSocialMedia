import { test, expect } from "@playwright/test";
import { API } from "../seed.mjs";

const headers = { "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true" };
const createdAt = new Date().toISOString();
const person = (username) => ({ id: username, username, displayName: username, avatarKey: null, createdAt });
const summary = { status: "open", serverNow: createdAt, startsAt: createdAt, windowEndsAt: new Date(Date.now() + 180_000).toISOString(), myPost: null, currentStreak: 0, bestStreak: 0 };

async function images(page) {
  return page.evaluate(() => ["#ed1212", "#1616ed"].map((color) => {
    const canvas = document.createElement("canvas"); canvas.width = 180; canvas.height = 320;
    const paint = canvas.getContext("2d"); paint.fillStyle = color; paint.fillRect(0, 0, 180, 320);
    return canvas.toDataURL("image/png").split(",")[1];
  })).then((values) => values.map((value) => Buffer.from(value, "base64")));
}

async function videoFixture(page) {
  const encoded = await page.evaluate(async () => new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 240;
    const paint = canvas.getContext("2d");
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const draw = window.setInterval(() => { paint.fillStyle = "#1616ed"; paint.fillRect(0, 0, 160, 240); }, 40);
    recorder.onerror = (event) => { window.clearInterval(draw); stream.getTracks().forEach((track) => track.stop()); reject(new Error(String(event))); };
    recorder.onstop = async () => {
      window.clearInterval(draw); stream.getTracks().forEach((track) => track.stop());
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      resolve(btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")));
    };
    recorder.start(); window.setTimeout(() => recorder.stop(), 2000);
  }));
  return Buffer.from(encoded, "base64");
}

test.beforeEach(async ({ context }, info) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${info.testId.split("").reduce((total, char) => total + char.charCodeAt(0), 0) % 200 + 30}` });
  await context.request.post(`${API}/users/me/update-notice/acknowledge`);
});

test("Stories decode atomically, pause while replying or holding, and advance across authors", async ({ page }, info) => {
  const [red, blue] = await images(page);
  await page.clock.install();
  const story = (id, imageKey) => ({ id, imageKey, videoKey: null, audioKey: null, audioDurationMs: null, text: null, createdAt, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), visibility: "public", circle: null, meetup: null, reactionCounts: [], myReaction: null });
  await page.route(/\/stories$/, (route) => route.fulfill({ headers, json: { groups: [
    { author: person("mia"), stories: [story("first", "story-red.png"), story("second", "story-blue.png")] },
    { author: person("noah"), stories: [story("third", "story-last.png")] },
  ] } }));
  let releaseRed, releaseBlue;
  const redGate = new Promise((resolve) => { releaseRed = resolve; });
  const blueGate = new Promise((resolve) => { releaseBlue = resolve; });
  await page.route(/\/media\/story-/, async (route) => {
    const redImage = route.request().url().includes("story-red");
    if (redImage) await redGate;
    else if (route.request().url().includes("story-blue")) await blueGate;
    await route.fulfill({ headers, contentType: "image/png", body: redImage ? red : blue });
  });
  await page.goto("/?story=first");
  let dialog = page.getByRole("dialog", { name: "Stories from @mia" });
  const progress = () => page.getByRole("progressbar", { name: "Story progress" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Story 1 from @mia" })).toHaveCount(0);
  await expect(dialog.getByRole("status", { name: "Loading Story 1 from @mia" })).toBeVisible();
  await page.clock.fastForward(12_000);
  await expect(progress()).toHaveAttribute("aria-valuenow", "0");
  releaseRed();
  await expect(dialog.getByRole("img", { name: "Story 1 from @mia" })).toBeVisible();
  await expect(dialog.getByRole("status", { name: "Loading Story 1 from @mia" })).toHaveCount(0);
  await dialog.getByPlaceholder("Reply to @mia...").focus();
  await dialog.getByPlaceholder("Reply to @mia...").press("ArrowRight");
  await expect(dialog.getByRole("img", { name: "Story 1 from @mia" })).toBeVisible();
  const paused = await progress().getAttribute("aria-valuenow");
  await page.clock.fastForward(12_000);
  await expect(progress()).toHaveAttribute("aria-valuenow", paused);
  await dialog.getByPlaceholder("Reply to @mia...").blur();
  await page.clock.fastForward(7500);
  await expect(dialog.getByRole("img", { name: "Story 2 from @mia" })).toHaveCount(0);
  await expect(dialog.getByRole("img", { name: "Story 1 from @mia" })).toHaveCount(0);
  releaseBlue();
  await expect(dialog.getByRole("img", { name: "Story 2 from @mia" })).toBeVisible();
  const next = dialog.getByRole("button", { name: "Next story" });
  await next.dispatchEvent("pointerdown", { clientX: 200, clientY: 200 });
  await page.clock.fastForward(12_000);
  await expect(dialog.getByRole("img", { name: "Story 2 from @mia" })).toBeVisible();
  await next.dispatchEvent("pointerup", { clientX: 200, clientY: 200 });
  await page.clock.fastForward(7500);
  dialog = page.getByRole("dialog", { name: "Stories from @noah" });
  await expect(dialog.getByRole("img", { name: "Story 1 from @noah" })).toBeVisible();
  await page.screenshot({ path: `screenshots/${info.project.name}/story-experience.png`, animations: "disabled" });
  const mobileViewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: `screenshots/${info.project.name}/story-experience-desktop.png`, animations: "disabled" });
  await page.setViewportSize(mobileViewport);
  await dialog.getByRole("button", { name: "Next story" }).dispatchEvent("pointerdown", { clientX: 200, clientY: 200 });
  await dialog.getByRole("button", { name: "Next story" }).dispatchEvent("pointerup", { clientX: 200, clientY: 310 });
  await expect(dialog).toHaveCount(0);
});

test("failed Story images can retry without advancing or exposing an incomplete image", async ({ page }) => {
  const [red] = await images(page);
  await page.clock.install();
  await page.route(/\/stories$/, (route) => route.fulfill({ headers, json: { groups: [{ author: person("mia"), stories: [{ id: "retry-story", imageKey: "retry-story.png", videoKey: null, audioKey: null, audioDurationMs: null, reactionCounts: [], myReaction: null, createdAt }] }] } }));
  await page.route(/\/media\/retry-story.png/, (route) => route.request().url().includes("retry=")
    ? route.fulfill({ headers, contentType: "image/png", body: red }) : route.fulfill({ headers, status: 503 }));
  await page.goto("/?story=retry-story");
  const dialog = page.getByRole("dialog", { name: "Stories from @mia" });
  await expect(dialog.getByRole("button", { name: "Retry Story 1 from @mia", exact: true })).toBeVisible();
  await page.clock.fastForward(20_000);
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await dialog.getByRole("button", { name: "Retry Story 1 from @mia", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "Story 1 from @mia" })).toBeVisible();
});

test("Moment identities survive refresh and slow media never overlays another person's picture", async ({ page }, info) => {
  const [red, blue] = await images(page);
  await page.clock.install();
  const mine = { id: "moment-leo", user: person("leo"), imageKey: "moment-red.png", mediaType: "image", caption: "Red Moment", late: false, lateBySeconds: 0, createdAt };
  const theirs = { ...mine, id: "moment-mia", user: person("mia"), imageKey: "moment-blue.png", caption: "Blue Moment" };
  await page.route(/\/moments\/today$/, (route) => route.fulfill({ headers, json: { ...summary, myPost: mine } }));
  let reads = 0;
  await page.route(/\/moments\/today\/feed$/, (route) => route.fulfill({ headers, json: { locked: false, friendPostCount: 1, posts: reads++ ? [mine, theirs] : [theirs, mine] } }));
  await page.route(/\/moments\/posts\/.*\/reactions$/, (route) => route.fulfill({ headers, json: { reactions: [] } }));
  let releaseBlue;
  const blueGate = new Promise((resolve) => { releaseBlue = resolve; });
  await page.route(/\/media\/moment-/, async (route) => {
    if (route.request().url().includes("blue")) await blueGate;
    await route.fulfill({ headers, contentType: "image/png", body: route.request().url().includes("blue") ? blue : red });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Today's Moment" }).click();
  const dialog = page.getByRole("dialog", { name: "Today's Moment", exact: true });
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog.getByRole("img", { name: "Moment from @leo" })).toBeVisible();
  const redPixel = await dialog.getByRole("img", { name: "Moment from @leo" }).evaluate(async (image) => {
    const bitmap = await createImageBitmap(await (await fetch(image.currentSrc, { credentials: "include" })).blob());
    const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
    const paint = canvas.getContext("2d"); paint.drawImage(bitmap, 0, 0, 1, 1);
    const pixel = Array.from(paint.getImageData(0, 0, 1, 1).data); bitmap.close(); return pixel;
  });
  expect(redPixel[0]).toBeGreaterThan(200);
  expect(redPixel[2]).toBeLessThan(50);
  await page.clock.fastForward(31_000);
  await expect.poll(() => reads).toBeGreaterThan(1);
  await expect(dialog.getByRole("img", { name: "Moment from @leo" })).toBeVisible();
  await dialog.getByRole("button", { name: "Previous Moment" }).click();
  await expect(dialog.getByText("@mia", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Moment from @leo" })).toHaveCount(0);
  await expect(dialog.getByRole("img", { name: "Moment from @mia" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Next Moment" }).click();
  releaseBlue();
  await expect(dialog.getByRole("img", { name: "Moment from @leo" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Moment from @mia" })).toHaveCount(0);
  await page.screenshot({ path: `screenshots/${info.project.name}/moment-stable-media.png`, animations: "disabled" });
});

test("feed video keeps its poster and loading status until playback data is ready", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Synthetic WebM playback is unsupported in the WebKit project");
  const clip = await videoFixture(page);
  await page.route(/\/feed\?/, (route) => route.fulfill({ headers, json: {
    items: [{ type: "post", id: "video-feed-item", createdAt, post: {
      id: "video-feed-post", author: person("mia"), text: "Video post", imageKey: "feed-clip.webm", mediaType: "video",
      createdAt, visibility: "public", circle: null, parentPostId: null, pollId: null, replyCount: 0, commentCount: 0, factCheckCount: 0,
    } }],
    nextCursor: null, caughtUp: false, boundaryIndex: null,
  } }));
  await page.route(/\/media\/feed-clip\.webm\?poster=1/, (route) => route.fulfill({ headers, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") }));
  let releaseVideo;
  const videoGate = new Promise((resolve) => { releaseVideo = resolve; });
  let videoRequests = 0;
  await page.route(/\/media\/feed-clip\.webm$/, async (route) => { videoRequests++; await videoGate; await route.fulfill({ headers, contentType: "video/webm", body: clip }); });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Loading post video" })).toBeVisible();
  await expect.poll(() => videoRequests).toBeGreaterThan(0);
  releaseVideo();
  await expect(page.getByRole("status", { name: "Loading post video" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry video" })).toHaveCount(0);
});

test("Snaps load without consuming, pause for hold and reply, and advance without replaying stale inbox entries", async ({ page }, info) => {
  await page.addInitScript(() => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Test camera unavailable", "NotAllowedError"); }; });
  const [red, blue] = await images(page);
  await page.clock.install();
  const snaps = ["red", "blue"].map((color) => ({ id: `snap-${color}`, sender: person("mia"), imageKey: `snap-${color}.png`, text: `${color} Snap`, isEncrypted: false, encryptedPayload: null, createdAt, viewedAt: null }));
  await page.route(/\/snaps\/inbox$/, (route) => route.fulfill({ headers, json: { snaps, recentlyViewed: [] } }));
  await page.route(/\/snaps\/streaks$/, (route) => route.fulfill({ headers, json: { streaks: [] } }));
  const viewed = [];
  await page.route(/\/snaps\/snap-(red|blue)\/view$/, (route) => {
    if (route.request().method() !== "OPTIONS") viewed.push(route.request().url().split("/").at(-2));
    return route.fulfill({ status: 204, headers: { ...headers, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type,x-forwarded-for" } });
  });
  let releaseRed, releaseBlue;
  const redGate = new Promise((resolve) => { releaseRed = resolve; });
  const blueGate = new Promise((resolve) => { releaseBlue = resolve; });
  await page.route(/\/media\/snap-/, async (route) => {
    const isRed = route.request().url().includes("snap-red");
    await (isRed ? redGate : blueGate);
    await route.fulfill({ headers, contentType: "image/png", body: isRed ? red : blue });
  });
  await page.goto("/snaps");
  const row = page.getByRole("region", { name: "Received Snaps" }).getByRole("button", { name: /New Snap/ });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("New Snap · 2");
  await row.click();
  await expect(page.getByRole("dialog", { name: "Opening Snap", exact: true })).toBeVisible();
  await page.clock.fastForward(12_000);
  expect(viewed).toEqual([]);
  await page.getByRole("button", { name: "Cancel opening Snap" }).click();
  releaseRed();
  await expect(page.getByRole("dialog", { name: "Opening Snap", exact: true })).toHaveCount(0);
  expect(viewed).toEqual([]);
  await row.click();
  const dialog = page.getByRole("dialog", { name: "Snap from @mia", exact: true });
  await expect(dialog).toHaveCSS("opacity", "1");
  const image = dialog.getByRole("img", { name: "Snap from @mia", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => viewed.length).toBe(1);
  const field = dialog.getByPlaceholder("Quick reply");
  await field.focus();
  const progress = page.getByRole("progressbar", { name: "Snap progress" });
  const paused = await progress.getAttribute("aria-valuenow");
  await page.clock.fastForward(12_000);
  await expect(progress).toHaveAttribute("aria-valuenow", paused);
  await field.blur();
  await image.dispatchEvent("pointerdown", { clientX: 150, clientY: 250 });
  await page.clock.fastForward(12_000);
  await expect(dialog.getByText("red Snap", { exact: true })).toBeVisible();
  await image.dispatchEvent("pointerup", { clientX: 150, clientY: 250 });
  await image.click();
  await expect(page.getByRole("dialog", { name: "Opening Snap", exact: true })).toBeVisible();
  await expect(image).toHaveCount(0);
  releaseBlue();
  await expect(dialog.getByText("blue Snap", { exact: true })).toBeVisible();
  await expect.poll(() => viewed).toEqual(["snap-red", "snap-blue"]);
  await expect(dialog.getByRole("button", { name: "Reply with a Snap" })).toBeVisible();
  await page.screenshot({ path: `screenshots/${info.project.name}/snap-experience.png`, animations: "disabled" });
  await image.click();
  await page.clock.fastForward(300);
  await expect(dialog).toHaveCount(0);
  expect(viewed).toEqual(["snap-red", "snap-blue"]);
});

test("Snap camera replies open the camera with the sender selected", async ({ page }) => {
  const [red] = await images(page);
  await page.addInitScript(() => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Test camera unavailable", "NotAllowedError"); }; });
  await page.route(/\/snaps\/inbox$/, (route) => route.fulfill({ headers, json: { snaps: [{ id: "camera-reply", sender: person("mia"), imageKey: "snap-camera.png", text: null, isEncrypted: false, createdAt }], recentlyViewed: [] } }));
  await page.route(/\/media\/snap-camera.png/, (route) => route.fulfill({ headers, contentType: "image/png", body: red }));
  await page.route(/\/snaps\/camera-reply\/view$/, (route) => route.fulfill({ headers, status: 204 }));
  await page.goto("/snaps");
  await page.getByRole("region", { name: "Received Snaps" }).getByRole("button", { name: /New Snap/ }).click();
  await page.getByRole("button", { name: "Reply with a Snap" }).click();
  await expect(page.getByRole("button", { name: "Close camera", exact: true })).toBeVisible();
  await expect(page.locator("#camera-file-picker")).toHaveCount(1);
});

test("Snap video pauses on hold and advances once when the clip ends", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Requires the Chromium synthetic canvas recording fixture");
  const [red] = await images(page);
  const clip = await videoFixture(page);
  const snaps = [{ id: "video", sender: person("mia"), imageKey: "clip.webm", text: "Video Snap", isEncrypted: false, createdAt }, { id: "photo", sender: person("mia"), imageKey: "after-video.png", text: "Next photo", isEncrypted: false, createdAt }];
  await page.route(/\/snaps\/inbox$/, (route) => route.fulfill({ headers, json: { snaps, recentlyViewed: [] } }));
  await page.route(/\/snaps\/(video|photo)\/view$/, (route) => route.fulfill({ headers, status: 204 }));
  await page.route(/\/media\/clip.webm/, (route) => route.fulfill({ headers, contentType: "video/webm", body: clip }));
  await page.route(/\/media\/after-video.png/, (route) => route.fulfill({ headers, contentType: "image/png", body: red }));
  await page.goto("/snaps");
  await page.getByRole("region", { name: "Received Snaps" }).getByRole("button", { name: /New Snap/ }).click();
  const video = page.getByLabel("Snap video from @mia", { exact: true });
  await expect(video).toBeVisible();
  await video.dispatchEvent("pointerdown", { clientX: 180, clientY: 200 });
  await expect(video).toHaveJSProperty("paused", true);
  await video.dispatchEvent("pointerup", { clientX: 180, clientY: 200 });
  await expect(page.getByText("Next photo", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(video).toHaveCount(0);
});

test("Story video pauses during a reply and advances to the next image on end", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Requires the Chromium synthetic canvas recording fixture");
  const [red] = await images(page);
  const clip = await videoFixture(page);
  const base = { audioKey: null, audioDurationMs: null, text: null, createdAt, reactionCounts: [], myReaction: null };
  await page.route(/\/stories$/, (route) => route.fulfill({ headers, json: { groups: [{ author: person("mia"), stories: [{ ...base, id: "clip", imageKey: "video-poster.png", videoKey: "story-clip.webm" }, { ...base, id: "image", imageKey: "after-clip.png", videoKey: null }] }] } }));
  await page.route(/\/media\/(video-poster|after-clip).png/, (route) => route.fulfill({ headers, contentType: "image/png", body: red }));
  await page.route(/\/media\/story-clip.webm/, (route) => route.fulfill({ headers, contentType: "video/webm", body: clip }));
  await page.goto("/?story=clip");
  const video = page.getByLabel("Story video", { exact: true });
  await expect(video).toBeVisible();
  await page.getByPlaceholder("Reply to @mia...").focus();
  await expect(video).toHaveJSProperty("paused", true);
  await page.getByPlaceholder("Reply to @mia...").blur();
  await expect(page.getByRole("img", { name: "Story 2 from @mia" })).toBeVisible({ timeout: 10_000 });
  await expect(video).toHaveCount(0);
});