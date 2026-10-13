import { execSync } from "node:child_process";
import { seed } from "./seed.mjs";

// Every fresh browser registers a device key; clear them so repeated runs never hit the per-user limit.
function resetDeviceKeys() {
  try {
    execSync(
      `docker exec code-postgres-1 psql -U app -d e2e -c 'DELETE FROM "Message"; DELETE FROM "EncryptionKey"'`,
      { stdio: "ignore" }
    );
  } catch {
    // The table may not exist yet on the very first run.
  }
}

export default async function globalSetup() {
  await seed();
  resetDeviceKeys();
}
