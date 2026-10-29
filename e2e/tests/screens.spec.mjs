import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { API } from "../seed.mjs";

// A fresh database shows the "New Update" dialog, which would cover every screenshot.
test.beforeEach(async ({ context }) => {
  await context.request.post(`${API}/users/me/update-notice/acknowledge`);
});

// Earlier tests fill the per-user device key limit (10); this flow registers fresh browsers.
function clearDeviceKeys() {
  execSync(`docker exec code-postgres-1 psql -U app -d e2e -c 'DELETE FROM "EncryptionKey"'`, { stdio: "ignore" });
}

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
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("intouch:theme", value), theme);
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

test("camera opens with a live preview", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "needs the fake camera of Chromium");
  await page.goto("/");
  await page.getByRole("button", { name: "Open camera" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `screenshots/${info.project.name}/light/camera.png` });
});

for (const theme of ["light", "dark"]) {
  test(`chat conversation ${theme}`, async ({ browser, page }, info) => {
    clearDeviceKeys();
    await page.addInitScript((value) => localStorage.setItem("intouch:theme", value), theme);
    // Messages are end-to-end encrypted, so the friend must have opened Messages once to own a key.
    const friend = await browser.newContext({ storageState: ".auth/mia.json" });
    const friendPage = await friend.newPage();
    await friendPage.goto("http://localhost:5173/dms");
    await expect.poll(async () => (await (await friend.request.get(`${API}/users/mia/encryption-keys`)).json()).keys.length).toBeGreaterThan(0);
    await friend.close();

    await page.goto("/dms");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `screenshots/${info.project.name}/${theme}/messages-list.png` });
    await page.getByRole("button", { name: /@mia/ }).first().click();
    await page.waitForTimeout(800);
    for (const text of ["Hey! Are you coming tonight?", "I can bring snacks 🍿"]) {
      // Incoming delivery updates can clear the draft in WebKit, so retype until it can be sent.
      await expect(async () => {
        await page.getByLabel("Message", { exact: true }).fill(text);
        await page.getByRole("button", { name: "Send message" }).click({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: `screenshots/${info.project.name}/${theme}/messages-chat.png` });
  });
}
