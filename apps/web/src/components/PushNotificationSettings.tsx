import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.js";
import { btnPrimary, card } from "../lib/ui.js";

type PushState =
  | "checking"
  | "ready"
  | "enabled"
  | "install-required"
  | "permission-denied"
  | "unsupported"
  | "not-configured"
  | "error";

interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

function decodeApplicationServerKey(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer as ArrayBuffer;
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  await apiFetch("/notifications/push/subscription", {
    method: "PUT",
    body: JSON.stringify(value),
  });
}

export default function PushNotificationSettings() {
  const [status, setStatus] = useState<PushState>("checking");
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setStatus("unsupported");
        return;
      }
      if (isIos() && !isStandalone()) {
        if (active) setStatus("install-required");
        return;
      }

      try {
        const pushConfig = await apiFetch<PushConfig>("/notifications/push/config");
        if (!active) return;
        setConfig(pushConfig);
        if (!pushConfig.enabled || !pushConfig.publicKey) {
          setStatus("not-configured");
          return;
        }
        if (Notification.permission === "denied") {
          setStatus("permission-denied");
          return;
        }
        if (Notification.permission === "granted") {
          const registration = await navigator.serviceWorker.register("/sw.js");
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await saveSubscription(subscription);
            if (active) setStatus("enabled");
            return;
          }
        }
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function togglePush() {
    setBusy(true);
    setError(null);
    try {
      if (status === "error") {
        const pushConfig = await apiFetch<PushConfig>("/notifications/push/config");
        setConfig(pushConfig);
        setStatus(pushConfig.enabled && pushConfig.publicKey ? "ready" : "not-configured");
        return;
      }

      if (status === "enabled") {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await apiFetch("/notifications/push/subscription", {
            method: "DELETE",
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          await subscription.unsubscribe();
        }
        setStatus("ready");
        return;
      }

      if (!config?.publicKey) {
        setStatus("not-configured");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "permission-denied" : "ready");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(config.publicKey),
      });
      await saveSubscription(subscription);
      setStatus("enabled");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update push notifications.");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  const helperText = {
    checking: "Checking this device…",
    ready: "Tap the button and allow notifications in your browser.",
    enabled: "Push notifications are on for this device. Message and Snap contents stay private.",
    "install-required": "On iPhone or iPad: open this page in Safari, tap Share → Add to Home Screen, then open InTouch from that icon.",
    "permission-denied": "Notifications are blocked. Allow them for this site in your browser settings, then try again.",
    unsupported: "This browser does not support push notifications.",
    "not-configured": "Push notifications are not set up on this server yet.",
    error: "Could not check this device. Tap Try again to retry.",
  }[status];
  const disabled = busy || status === "checking" || status === "unsupported" ||
    status === "install-required" || status === "permission-denied" || status === "not-configured";

  return (
    <section aria-labelledby="push-settings-title" className={`${card} mb-4 p-3 sm:p-4`}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M10 21h4" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="push-settings-title" className="text-sm font-semibold text-gray-900">Phone notifications</h2>
          <p aria-live="polite" className="mt-1 text-xs leading-5 text-gray-600">{helperText}</p>
          {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
          {status === "install-required" && (
            <p className="mt-1 text-xs leading-5 text-gray-500">Then return here and tap Turn on. Android users can turn them on directly in the browser.</p>
          )}
          <button
            type="button"
            onClick={() => void togglePush()}
            disabled={disabled}
            className={`${btnPrimary} mt-3 min-h-10 w-full sm:w-auto`}
          >
            {busy ? "Please wait…" : status === "enabled" ? "Turn off" : status === "error" ? "Try again" : status === "checking" ? "Checking…" : "Turn on"}
          </button>
        </div>
      </div>
    </section>
  );
}