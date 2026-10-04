import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth, ApiError } from "../auth/AuthContext.js";
import { card, input, btnPrimary } from "../lib/ui.js";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("invite") ?? ""
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!location.hash) return;
    window.history.replaceState(null, "", `${location.pathname}${location.search}`);
  }, [location.hash, location.pathname, location.search]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register(email, username, password, inviteCode);
      navigate("/");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Registration failed"
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className={`${card} w-full max-w-sm`}>
        <h1 className="mb-6 text-xl font-semibold">Sign up</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
            required
          />
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={input}
            required
          />
          <input
            type="password"
            placeholder="Password (at least 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
            required
          />
          <input
            type="text"
            placeholder="Invitation code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className={input}
            autoComplete="off"
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className={btnPrimary}>
            Create account
          </button>
        </form>
        <p className="mt-4 text-sm text-gray-500">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-black hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
