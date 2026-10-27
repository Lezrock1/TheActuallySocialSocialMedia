import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.js";
import { btnPrimary, card } from "../lib/ui.js";
import {
  disablePush,
  enablePush,
  isIos,
  isStandalone,
  restorePushSubscription,
} from "../lib/push.js";
import type { PushConfig } from "../lib/push.js";

type PushState =
  | "checking"
  | "ready"
  | "enabled"
  | "install-required"
  | "permission-denied"
  | "unsupported"
  | "not-configured"
  | "error";

export default function PushNotificationSettings() {
  const [status, setStatus] = useState<PushState>("checking");
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
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
          if (await restorePushSubscription()) {
            if (active) setStatus("enabled");
            return;
          }
        }
        setStatus("ready");
      } catch {
        if (active) setStatus((current) => current === "enabled" ? current : "error");
      }
      } finally { checking = false; }
    };
    void check();
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  async function togglePush() {
    setBusy(true);
    setError(null);
    try {
      if (status === "error") {
        const pushConfig = await apiFetch<PushConfig>("/notifications/push/config");
        setConfig(pushConfig);
        setStatus(!pushConfig.enabled || !pushConfig.publicKey ? "not-configured" : await restorePushSubscription() ? "enabled" : "ready");
        return;
      }

      if (status === "enabled") {
        await disablePush();
        setStatus("ready");
        return;
      }

      if (!config?.publicKey) {
        setStatus("not-configured");
        return;
      }
      const result = await enablePush();
      setStatus(result === "enabled" ? "enabled" : result === "denied" ? "permission-denied" : result === "unavailable" ? "not-configured" : "ready");
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