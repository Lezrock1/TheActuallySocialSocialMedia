import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth, ApiError } from "../auth/AuthContext.js";
import { card, input, btnPrimary } from "../lib/ui.js";

export default function LoginPage() {
  const { login, bootError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const accountDeletionState = location.state as {
    accountDeleted?: boolean;
    localCleanupWarning?: boolean;
  } | null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError("Enter the email address you registered with (not your username).");
      return;
    }
    setSubmitting(true);
    try {
      await login(trimmedEmail, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError
        ? err.message
        : "Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className={`${card} w-full max-w-sm`}>
        <h1 className="mb-6 text-xl font-semibold">Log in</h1>
        {bootError && (
          <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Server connection issue detected. You can still try signing in, or retry shortly.
          </p>
        )}
        {accountDeletionState?.accountDeleted && (
          <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            <p>Your account and its server data have been deleted.</p>
            {accountDeletionState.localCleanupWarning && (
              <p className="mt-1 text-xs">This browser could not remove its local encryption key. Clear this site’s data in your browser settings to remove it.</p>
            )}
          </div>
        )}
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <input
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={submitting} className={`${btnPrimary} disabled:opacity-60`}>
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="mt-4 text-sm text-gray-500">
          Don't have an account?{" "}
          <Link to="/register" className="font-medium text-black hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
