import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { enablePush, isIos, isStandalone, pushSupported } from "../lib/push.js";
import { btnPrimary } from "../lib/ui.js";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type PromptMode = "install" | "notify";

const SHOW_DELAY_MS = 2500;
// Never cover the chat composer, camera or forms: the reminder only appears on these browse pages.
const PROMPT_ROUTES = ["/", "/snaps", "/notifications"];
const REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function storageKey(userId: string, mode: PromptMode): string {
  return `intouch:device-prompt:${userId}:${mode}`;
}

function wasShownRecently(userId: string, mode: PromptMode): boolean {
  try {
    const last = Number(localStorage.getItem(storageKey(userId, mode)));
    return Number.isFinite(last) && last > 0 && Date.now() - last < REMIND_AFTER_MS;
  } catch {
    return false;
  }
}

function markShown(userId: string, mode: PromptMode): void {
  try {
    localStorage.setItem(storageKey(userId, mode), String(Date.now()));
  } catch {
    // Without storage the reminder simply appears again next visit.
  }
}

// First login and then now and then: nudge to add the app to the home screen and to enable notifications.
export default function DeviceSetupPrompt() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const allowedHere = PROMPT_ROUTES.includes(pathname);
  const [mode, setMode] = useState<PromptMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const installEventRef = useRef<InstallPromptEvent | null>(null);

  useEffect(() => {
    const update = () => setOverlayOpen(!!document.querySelector('[role="dialog"][aria-modal="true"], button[aria-label="Close camera"]'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onBeforeInstall(event: Event) {
      event.preventDefault();
      installEventRef.current = event as InstallPromptEvent;
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    if (!user || !allowedHere || overlayOpen) return;
    const timeout = window.setTimeout(() => {
      const canInstall = !isStandalone() && (isIos() || !!installEventRef.current);
      if (canInstall && !wasShownRecently(user.id, "install")) {
        setMode("install");
        return;
      }
      const canAskNotifications = pushSupported() && (!isIos() || isStandalone()) && Notification.permission === "default";
      if (canAskNotifications && !wasShownRecently(user.id, "notify")) setMode("notify");
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [user, allowedHere, overlayOpen]);

  if (!user || !mode || !allowedHere || overlayOpen) return null;

  function dismiss() {
    if (user && mode) markShown(user.id, mode);
    setMode(null);
    setError(null);
  }

  async function confirm() {
    if (!user || !mode) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "install") {
        const event = installEventRef.current;
        if (event) {
          await event.prompt();
          await event.userChoice;
          installEventRef.current = null;
        }
        dismiss();
        return;
      }
      const result = await enablePush();
      if (result === "unavailable") {
        setError("Notifications aren't available on this server yet.");
        return;
      }
      dismiss();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const iosInstall = mode === "install" && isIos();

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[65] flex justify-center sm:bottom-6">
      <section
        role="dialog"
        aria-labelledby="device-prompt-title"
        className="menu-enter pointer-events-auto w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.35)]"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fuchsia-50 text-fuchsia-600">
            {mode === "install" ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="2.5" width="12" height="19" rx="3" />
                <path d="M12 8v6m-3-3 3 3 3-3M10.5 18.5h3" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                <path d="M10 21h4" />
              </svg>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="device-prompt-title" className="text-sm font-semibold text-gray-900">
              {mode === "install" ? "Add InTouch to your home screen" : "Don't miss a thing"}
            </h2>
            <p className="mt-1 text-xs leading-5 text-gray-600">
              {mode === "install"
                ? "Open InTouch like a real app, full screen and one tap away. It's also the only way to get notifications on iPhone."
                : "Turn on notifications to know right away when friends send you Snaps, messages or invite you to a Live Room. Contents stay private."}
            </p>
            {iosInstall && (
              <ol className="mt-2 space-y-1 text-xs leading-5 text-gray-700">
                <li className="flex items-center gap-1.5">
                  <span className="font-semibold">1.</span> Tap
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-blue-600" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m0 0L8 7m4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" /></svg>
                  <span>Share in Safari</span>
                </li>
                <li><span className="font-semibold">2.</span> Choose “Add to Home Screen”</li>
              </ol>
            )}
            {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-3 flex items-center gap-2">
              {!iosInstall && (
                <button type="button" onClick={() => void confirm()} disabled={busy} className={`${btnPrimary} min-h-10 flex-1 sm:flex-none`}>
                  {busy ? "Please wait…" : mode === "install" ? "Install app" : "Turn on notifications"}
                </button>
              )}
              <button
                type="button"
                onClick={dismiss}
                disabled={busy}
                className={`min-h-10 rounded-xl px-3 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 ${iosInstall ? "ml-auto" : ""}`}
              >
                {iosInstall ? "Got it" : "Not now"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
