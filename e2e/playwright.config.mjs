import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const root = new URL("..", import.meta.url).pathname;
const localPnpm = join(homedir(), ".pnpm-tool/node_modules/.bin/pnpm");
const pnpm = process.env.PNPM_BIN ?? (existsSync(localPnpm) ? localPnpm : "pnpm");
export const BOOTSTRAP_INVITE_CODE = "e2e-bootstrap-invite-code-0123456789abcdef";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./global-setup.mjs",
  use: {
    baseURL: "http://localhost:5173",
    locale: "en-US",
    colorScheme: "light",
  },
  projects: [
    // WebKit with an iPhone profile is the closest match to the real Safari experience.
    { name: "iphone", use: { ...devices["iPhone 14"] } },
    {
      name: "android",
      use: {
        ...devices["Pixel 7"],
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        },
      },
    },
  ],
  webServer: [
    {
      // A separate database keeps demo data away from real local data; migrate deploy creates it when missing.
      command: "sh -c './node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx --env-file=.env src/server.ts'",
      cwd: `${root}apps/api`,
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        BOOTSTRAP_INVITE_CODE,
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://app:app@localhost:5432/e2e",
        PATH: process.env.PATH ?? "",
      },
    },
    {
      command: `${pnpm} --filter @app/web dev --port 5173 --strictPort`,
      cwd: root,
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
