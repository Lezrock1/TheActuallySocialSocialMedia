import { test } from "@playwright/test";
import { API, PASSWORD, email } from "../seed.mjs";

const SCREENS = [
  { name: "feed", path: "/" },
  { name: "snaps", path: "/snaps" },
  { name: "messages", path: "/dms" },
  { name: "alerts", path: "/notifications" },
  { name: "profile-me", path: "/u/leo" },
  { name: "profile-friend", path: "/u/mia" },
  { name: "people", path: "/people" },
  { name: "appearance", path: "/settings/appearance" },
];

for (const theme of ["light", "dark"]) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page, context }) => {
      await page.addInitScript((value) => localStorage.setItem("intouch:theme", value), theme);
      const response = await context.request.post(`${API}/auth/login`, {
        data: { email: email("leo"), password: PASSWORD },
      });
      if (!response.ok()) throw new Error(`Login failed: ${response.status()}`);
    });

    for (const screen of SCREENS) {
      test(`screenshot ${screen.name}`, async ({ page }, info) => {
        await page.goto(screen.path);
        await page.waitForLoadState("networkidle");
        // Let entrance animations finish; stay below the 2.5s delay of the home-screen reminder.
        await page.waitForTimeout(900);
        await page.screenshot({ path: `screenshots/${info.project.name}/${theme}/${screen.name}.png` });
      });
    }
  });
}

test("camera opens with a live preview", async ({ page, context }, info) => {
  test.skip(info.project.name !== "android", "needs the fake camera of Chromium");
  await context.request.post(`${API}/auth/login`, { data: { email: email("leo"), password: PASSWORD } });
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `screenshots/${info.project.name}/light/camera.png` });
});

for (const theme of ["light", "dark"]) {
  test(`chat conversation ${theme}`, async ({ browser, page, context }, info) => {
    await page.addInitScript((value) => localStorage.setItem("intouch:theme", value), theme);
    // Messages are end-to-end encrypted, so the friend must have opened Messages once to own a key.
    const friend = await browser.newContext();
    await friend.request.post(`${API}/auth/login`, { data: { email: email("mia"), password: PASSWORD } });
    const friendPage = await friend.newPage();
    await friendPage.goto("http://localhost:5173/dms");
    await friendPage.waitForTimeout(3000);
    await friend.close();

    await context.request.post(`${API}/auth/login`, { data: { email: email("leo"), password: PASSWORD } });
    await page.goto("/dms");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `screenshots/${info.project.name}/${theme}/messages-list.png` });
    await page.getByRole("button", { name: /@mia/ }).first().click();
    await page.waitForTimeout(800);
    for (const text of ["Hey! Are you coming tonight?", "I can bring snacks 🍿"]) {
      await page.getByLabel("Message", { exact: true }).fill(text);
      await page.getByRole("button", { name: "Send message" }).click();
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: `screenshots/${info.project.name}/${theme}/messages-chat.png` });
  });
}
