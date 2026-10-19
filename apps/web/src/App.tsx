import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
const LoginPage = lazy(() => import("./pages/LoginPage.js"));
const RegisterPage = lazy(() => import("./pages/RegisterPage.js"));
const FeedPage = lazy(() => import("./pages/FeedPage.js"));
const SnapsPage = lazy(() => import("./pages/SnapsPage.js"));
const DMsPage = lazy(() => import("./pages/DMsPage.js"));
const AiSettingsPage = lazy(() => import("./pages/AiSettingsPage.js"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.js"));
const PostThreadPage = lazy(() => import("./pages/PostThreadPage.js"));
const InvitationsPage = lazy(() => import("./pages/InvitationsPage.js"));
const CirclesPage = lazy(() => import("./pages/CirclesPage.js"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.js"));
const PeopleSearchPage = lazy(() => import("./pages/PeopleSearchPage.js"));
const NotificationSettingsPage = lazy(() => import("./pages/NotificationSettingsPage.js"));
const AccountSettingsPage = lazy(() => import("./pages/AccountSettingsPage.js"));
const SecuritySettingsPage = lazy(() => import("./pages/SecuritySettingsPage.js"));
const AppearanceSettingsPage = lazy(() => import("./pages/AppearanceSettingsPage.js"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.js"));
const ApiUnavailablePage = lazy(() => import("./pages/ApiUnavailablePage.js"));
const UsageDashboardPage = lazy(() => import("./pages/UsageDashboardPage.js"));
const HashtagPage = lazy(() => import("./pages/HashtagPage.js"));
import { MobileNav } from "./components/NavBar.js";
import { CameraProvider } from "./components/camera/CameraProvider.js";
import DeviceSetupPrompt from "./components/DeviceSetupPrompt.js";
import LocalMeetupReminderProvider from "./components/LocalMeetupReminderProvider.js";
import { pageSurfaceForPath, usePageBackground } from "./lib/pageBackground.js";
import { AppBootSkeleton } from "./components/LoadingSkeleton.js";
import { getSocket } from "./lib/socket.js";
import { apiFetch } from "./lib/api.js";
import CallProvider from "./components/CallProvider.js";

type DeploymentNoticeStatus = "started" | "complete" | "failed";

const deploymentNoticeCopy: Record<DeploymentNoticeStatus, { title: string; detail: string }> = {
  started: {
    title: "Updating InTouch",
    detail: "We're deploying a new version. Some actions may pause briefly.",
  },
  complete: {
    title: "Update complete",
    detail: "Everything should be back to normal.",
  },
  failed: {
    title: "Update taking longer than expected",
    detail: "Please wait a moment and try again.",
  },
};

function DeploymentNotice() {
  const { user } = useAuth();
  const [status, setStatus] = useState<DeploymentNoticeStatus | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    function onDeploymentStatus(payload: { status?: unknown }) {
      if (payload.status !== "started" && payload.status !== "complete" && payload.status !== "failed") return;
      const nextStatus = payload.status;
      setStatus(nextStatus);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        setStatus(null);
        hideTimerRef.current = null;
      }, nextStatus === "started" ? 120_000 : 5_000);
    }

    socket.on("deployment:status", onDeploymentStatus);
    return () => {
      socket.off("deployment:status", onDeploymentStatus);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [user?.id]);

  if (!status) return null;
  const copy = deploymentNoticeCopy[status];
  const colors = status === "started"
    ? "border-amber-300 bg-amber-50 text-amber-950"
    : status === "failed"
      ? "border-red-300 bg-red-50 text-red-950"
      : "border-emerald-300 bg-emerald-50 text-emerald-950";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] mx-auto flex max-w-xl items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${colors}`}
    >
      <span aria-hidden="true" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-current" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{copy.title}</span>
        <span className="mt-0.5 block text-xs leading-5 opacity-85">{copy.detail}</span>
      </span>
      <button
        type="button"
        onClick={() => setStatus(null)}
        aria-label="Dismiss update notice"
        className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-70 transition-opacity hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

function NewUpdateNotice() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryKey = ["update-notice", user?.id, 1];
  const { data } = useQuery({
    queryKey,
    queryFn: () => apiFetch<{ shouldShow: boolean }>("/users/me/update-notice"),
    enabled: !!user,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const socket = getSocket();
    function onAcknowledged(payload: { version?: unknown }) {
      if (payload.version === 1) queryClient.setQueryData(["update-notice", userId, 1], { shouldShow: false });
    }
    socket.on("update-notice:acknowledged", onAcknowledged);
    return () => {
      socket.off("update-notice:acknowledged", onAcknowledged);
    };
  }, [user?.id, queryClient]);

  async function acknowledge() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/users/me/update-notice/acknowledge", { method: "POST" });
      queryClient.setQueryData(queryKey, { shouldShow: false });
    } catch {
      setError("Could not save this yet. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!user || !data?.shouldShow) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-gray-950/40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-[2px] sm:items-center sm:px-4 sm:py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-update-title"
        className="menu-enter w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_24px_70px_-20px_rgba(15,23,42,0.45)]"
      >
        <div className="border-b border-emerald-100 bg-emerald-50/70 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <span aria-hidden="true" className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 bg-white text-lg">🍒</span>
          <h2 id="new-update-title" className="text-xl font-bold text-gray-950">New Update🍒</h2>
          <p className="mt-1 text-sm text-gray-600">A few new ways to stay connected.</p>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <ul className="space-y-3">
            <li className="flex gap-3 text-sm leading-5 text-gray-700"><span className="mt-0.5 text-emerald-700">•</span><span><b className="text-gray-900">Messages</b> — A cleaner layout on mobile and desktop.</span></li>
            <li className="flex gap-3 text-sm leading-5 text-gray-700"><span className="mt-0.5 text-emerald-700">•</span><span><b className="text-gray-900">Online status</b> — A green ring shows when chat contacts are online.</span></li>
            <li className="flex gap-3 text-sm leading-5 text-gray-700"><span className="mt-0.5 text-emerald-700">•</span><span><b className="text-gray-900">Snaps</b> — Streaks that need your reply show first.</span></li>
            <li className="flex gap-3 text-sm leading-5 text-gray-700"><span className="mt-0.5 text-emerald-700">•</span><span><b className="text-gray-900">Moments</b> — Daily Moments now live in Stories.</span></li>
            <li className="flex gap-3 text-sm leading-5 text-gray-700"><span className="mt-0.5 text-emerald-700">•</span><span><b className="text-gray-900">Music</b> — Share a track, drop a mix, listen together and compare taste.</span></li>
          </ul>
          {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => void acknowledge()}
            disabled={saving}
            className="mt-5 min-h-11 w-full rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Got it"}
          </button>
        </div>
      </section>
    </div>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading, bootError, retryBootstrap } = useAuth();
  if (loading) return <AppBootSkeleton />;
  if (!user && bootError) {
    return <ApiUnavailablePage onRetry={() => void retryBootstrap()} />;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <div className="pb-20 sm:pb-0">{children}</div>;
}

function titleForPath(pathname: string): string {
  if (pathname.startsWith("/tags/")) return "Hashtag";
  if (pathname === "/dashboard") return "Public Dashboard";
  if (pathname === "/") return "Feed";
  if (pathname.startsWith("/dms")) return "Messages";
  if (pathname.startsWith("/snaps")) return "Snaps";
  if (pathname.startsWith("/notifications")) return "Notifications";
  if (pathname.startsWith("/people")) return "Find People";
  if (pathname.startsWith("/settings/ai")) return "AI Tools";
  if (pathname.startsWith("/settings/notifications")) return "Notification Settings";
  if (pathname.startsWith("/settings/account")) return "Account Settings";
  if (pathname.startsWith("/settings/security")) return "Security";
  if (pathname.startsWith("/settings/appearance")) return "Appearance";
  if (pathname.startsWith("/invitations")) return "Invitations";
  if (pathname.startsWith("/circles")) return "Circles";
  if (pathname.startsWith("/post/")) return "Post";
  if (pathname.startsWith("/u/")) return "Profile";
  if (pathname.startsWith("/login")) return "Login";
  if (pathname.startsWith("/register")) return "Register";
  return "Not Found";
}

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  usePageBackground(pageSurfaceForPath(location.pathname));
  useEffect(() => {
    if (!user || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    const send = async (type: string, tags: string[]) => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!cancelled) registration?.active?.postMessage({ type, tags });
    };
    const sync = () => {
      if (document.hidden) return;
      void apiFetch<{ tags: string[] }>("/notifications/push/active").then(({ tags }) => send("notifications:sync", tags)).catch(() => undefined);
    };
    const cleared = ({ ids }: { ids: string[] }) => {
      void send("notifications:clear", ids).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };
    const socket = getSocket();
    socket.on("notifications:cleared", cleared);
    socket.on("connect", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      cancelled = true;
      socket.off("notifications:cleared", cleared);
      socket.off("connect", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [user?.id, queryClient]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const openNotification = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "intouch:notification-open" || typeof event.data.url !== "string") return;
      try {
        const target = new URL(event.data.url, window.location.origin);
        if (target.origin === window.location.origin) navigate(`${target.pathname}${target.search}${target.hash}`);
      } catch {}
    };
    navigator.serviceWorker.addEventListener("message", openNotification);
    return () => navigator.serviceWorker.removeEventListener("message", openNotification);
  }, [navigate]);
  useEffect(() => {
    document.title = `${titleForPath(location.pathname)} · InTouch`;
  }, [location.pathname]);
  const showMobileNav = !!user && location.pathname !== "/login" && location.pathname !== "/register";
  return (
    <>
    <NewUpdateNotice />
    <DeploymentNotice />
    <div key={location.pathname} className="route-enter">
      <Suspense fallback={<AppBootSkeleton />}>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<UsageDashboardPage />} />
        <Route path="/tags/:tag" element={<RequireAuth><HashtagPage /></RequireAuth>} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <FeedPage />
            </RequireAuth>
          }
        />
        <Route
          path="/snaps"
          element={
            <RequireAuth>
              <SnapsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dms"
          element={
            <RequireAuth>
              <DMsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/ai"
          element={
            <RequireAuth>
              <AiSettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/notifications"
          element={
            <RequireAuth>
              <NotificationSettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/account"
          element={
            <RequireAuth>
              <AccountSettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/security"
          element={
            <RequireAuth>
              <SecuritySettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/appearance"
          element={
            <RequireAuth>
              <AppearanceSettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/invitations"
          element={
            <RequireAuth>
              <InvitationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/notifications"
          element={
            <RequireAuth>
              <NotificationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/circles"
          element={
            <RequireAuth>
              <CirclesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/people"
          element={
            <RequireAuth>
              <PeopleSearchPage />
            </RequireAuth>
          }
        />
        <Route
          path="/u/:username"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="/post/:id"
          element={
            <RequireAuth>
              <PostThreadPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </div>
    {showMobileNav && <MobileNav />}
    {showMobileNav && <DeviceSetupPrompt />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LocalMeetupReminderProvider>
        <CameraProvider>
          <CallProvider><AppRoutes /></CallProvider>
        </CameraProvider>
      </LocalMeetupReminderProvider>
    </AuthProvider>
  );
}
