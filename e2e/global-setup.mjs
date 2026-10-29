import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { request } from "@playwright/test";
import { API, PASSWORD, email, seed } from "./seed.mjs";

// Every fresh browser registers a device key and clears old chat history so screenshots stay clean.
function resetChatData() {
  try {
    execSync(
      `docker exec code-postgres-1 psql -U app -d e2e -c 'DELETE FROM "Message"; DELETE FROM "EncryptionKey"'`,
      { stdio: "ignore" }
    );
  } catch {
    // The tables may not exist yet on the very first run.
  }
}

// Logging in once per run keeps the tests under the API's login rate limit.
async function saveSession(username) {
  const context = await request.newContext({ baseURL: API });
  const response = await context.post("/auth/login", { data: { email: email(username), password: PASSWORD } });
  if (!response.ok()) throw new Error(`Login failed for ${username}: ${response.status()}`);
  await context.storageState({ path: `.auth/${username}.json` });
  await context.dispose();
}

export default async function globalSetup() {
  await seed();
  resetChatData();
  mkdirSync(".auth", { recursive: true });
  await saveSession("leo");
  await saveSession("mia");
}
