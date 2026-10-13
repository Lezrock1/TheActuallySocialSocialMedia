import { apiFetch } from "./api.js";

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function decodeApplicationServerKey(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer as ArrayBuffer;
}

export async function getActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  await apiFetch("/notifications/push/subscription", {
    method: "PUT",
    body: JSON.stringify(value),
  });
}

export type EnablePushResult = "enabled" | "denied" | "dismissed" | "unavailable";

// Must be called from a user gesture so the browser shows its permission dialog.
export async function enablePush(): Promise<EnablePushResult> {
  const config = await apiFetch<PushConfig>("/notifications/push/config");
  if (!config.enabled || !config.publicKey) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "dismissed";
  const registration = await getActiveServiceWorkerRegistration();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeApplicationServerKey(config.publicKey),
  });
  await saveSubscription(subscription);
  return "enabled";
}
