import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "../lib/api.js";
import { btnPrimary, card, input } from "../lib/ui.js";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    window.history.replaceState(window.history.state, "", "/reset-password");
  }, [token]);

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not request a reset link. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmReset(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not reset the password. Request a new link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className={`${card} w-full max-w-sm`}>
        <h1 className="mb-2 text-xl font-semibold">{token ? "Choose a new password" : "Reset your password"}</h1>
        {done ? (
          <div role="status" className="space-y-4">
            <p className="text-sm text-gray-600">Your password has been updated. Sign in with your new password.</p>
            <button type="button" className={btnPrimary} onClick={() => navigate("/login", { replace: true })}>Go to login</button>
          </div>
        ) : token ? (
          <form onSubmit={(event) => void confirmReset(event)} className="flex flex-col gap-3">
            <p className="mb-2 text-sm text-gray-600">Choose a password with at least 8 characters. This will sign out other devices.</p>
            <input autoComplete="new-password" type="password" minLength={8} required placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} className={input} />
            <input autoComplete="new-password" type="password" minLength={8} required placeholder="Confirm new password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={input} />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={submitting} className={`${btnPrimary} disabled:opacity-60`}>{submitting ? "Updating…" : "Update password"}</button>
          </form>
        ) : sent ? (
          <p role="status" className="text-sm text-gray-600">If an account exists for this email, a reset link has been sent. Check your inbox.</p>
        ) : (
          <form onSubmit={(event) => void requestReset(event)} className="flex flex-col gap-3">
            <p className="mb-2 text-sm text-gray-600">We’ll email you a one-time reset link if an account uses that address.</p>
            <input autoComplete="email" type="email" required placeholder="Email address" value={email} onChange={(event) => setEmail(event.target.value)} className={input} />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={submitting} className={`${btnPrimary} disabled:opacity-60`}>{submitting ? "Sending…" : "Send reset link"}</button>
          </form>
        )}
        {!done && <p className="mt-4 text-sm text-gray-500"><Link to="/login" className="font-medium text-black hover:underline">Back to login</Link></p>}
      </section>
    </main>
  );
}
