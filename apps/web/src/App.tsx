import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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
import { MobileNav } from "./components/NavBar.js";
import { CameraProvider } from "./components/camera/CameraProvider.js";
import DeviceSetupPrompt from "./components/DeviceSetupPrompt.js";
import LocalMeetupReminderProvider from "./components/LocalMeetupReminderProvider.js";
import { pageSurfaceForPath, usePageBackground } from "./lib/pageBackground.js";
import { AppBootSkeleton } from "./components/LoadingSkeleton.js";
import { getSocket } from "./lib/socket.js";

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
  const { user } = useAuth();
  usePageBackground(pageSurfaceForPath(location.pathname));
  useEffect(() => {
    document.title = `${titleForPath(location.pathname)} · InTouch`;
  }, [location.pathname]);
  const showMobileNav = !!user && location.pathname !== "/login" && location.pathname !== "/register";
  return (
    <>
    <DeploymentNotice />
    <div key={location.pathname} className="route-enter">
      <Suspense fallback={<AppBootSkeleton />}>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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
          <AppRoutes />
        </CameraProvider>
      </LocalMeetupReminderProvider>
    </AuthProvider>
  );
}
