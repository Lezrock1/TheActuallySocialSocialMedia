import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth, ApiError } from "../auth/AuthContext.js";
import { card, input, btnPrimary } from "../lib/ui.js";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className={`${card} w-full max-w-sm`}>
        <h1 className="mb-6 text-xl font-semibold">Log in</h1>
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
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className={btnPrimary}>
            Log in
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
