import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import LoginPage from "./pages/LoginPage.js";
import RegisterPage from "./pages/RegisterPage.js";
import FeedPage from "./pages/FeedPage.js";
import SnapsPage from "./pages/SnapsPage.js";
import DMsPage from "./pages/DMsPage.js";
import AiSettingsPage from "./pages/AiSettingsPage.js";
import ProfilePage from "./pages/ProfilePage.js";
import PostThreadPage from "./pages/PostThreadPage.js";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8">Lädt…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
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
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
