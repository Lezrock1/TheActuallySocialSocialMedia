import { apiFetch } from "./api.js";
import { ensureDeviceEncryptionKey } from "./encryption.js";
import type { DeviceEncryptionKey } from "./encryption.js";

const keyRegistrationRequests = new Map<string, Promise<DeviceEncryptionKey>>();

export function registerDeviceEncryptionKey(userId: string): Promise<DeviceEncryptionKey> {
  const pending = keyRegistrationRequests.get(userId);
  if (pending) return pending;

  const registration = (async () => {
    const key = await ensureDeviceEncryptionKey(userId);
    const registered = await apiFetch<{ fingerprint: string }>(
      "/users/me/encryption-keys",
      { method: "POST", body: JSON.stringify({ publicKey: key.publicKey }) }
    );
    if (registered.fingerprint !== key.fingerprint) {
      throw new Error("The registered encryption key does not match this device");
    }
    return key;
  })();

  keyRegistrationRequests.set(userId, registration);
  void registration.catch(() => keyRegistrationRequests.delete(userId));
  return registration;
}

export function forgetDeviceEncryptionKeyRegistration(userId: string): void {
  keyRegistrationRequests.delete(userId);
}