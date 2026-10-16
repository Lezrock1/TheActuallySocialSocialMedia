import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

export default defineConfig({ ...base, use: { ...base.use, storageState: ".auth/leo.json", serviceWorkers: "block" }, globalSetup: undefined, testMatch: ["social-context.spec.mjs", "feed-navigation.spec.mjs", "media-experience.spec.mjs"] });