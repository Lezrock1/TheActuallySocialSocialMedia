import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import LoginPage from "./pages/LoginPage.js";
import RegisterPage from "./pages/RegisterPage.js";
import FeedPage from "./pages/FeedPage.js";
import SnapsPage from "./pages/SnapsPage.js";
import DMsPage from "./pages/DMsPage.js";
import AiSettingsPage from "./pages/AiSettingsPage.js";
import ProfilePage from "./pages/ProfilePage.js";
import PostThreadPage from "./pages/PostThreadPage.js";
import InvitationsPage from "./pages/InvitationsPage.js";
import NotificationsPage from "./pages/NotificationsPage.js";
import PeopleSearchPage from "./pages/PeopleSearchPage.js";
import NotificationSettingsPage from "./pages/NotificationSettingsPage.js";
import AccountSettingsPage from "./pages/AccountSettingsPage.js";
import SecuritySettingsPage from "./pages/SecuritySettingsPage.js";
import NotFoundPage from "./pages/NotFoundPage.js";
import ApiUnavailablePage from "./pages/ApiUnavailablePage.js";
import { MobileNav } from "./components/NavBar.js";
import { pageSurfaceForPath, usePageBackground } from "./lib/pageBackground.js";
import { AppBootSkeleton } from "./components/LoadingSkeleton.js";

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
  if (pathname.startsWith("/invitations")) return "Invitations";
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
    <div key={location.pathname} className="route-enter">
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
    </div>
    {showMobileNav && <MobileNav />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
