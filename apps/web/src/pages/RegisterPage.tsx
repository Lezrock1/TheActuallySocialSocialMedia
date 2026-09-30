import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth, ApiError } from "../auth/AuthContext.js";
import { card, input, btnPrimary } from "../lib/ui.js";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register(email, username, password);
      navigate("/");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Registrierung fehlgeschlagen"
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className={`${card} w-full max-w-sm`}>
        <h1 className="mb-6 text-xl font-semibold">Registrieren</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="E-Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
            required
          />
          <input
            type="text"
            placeholder="Nutzername"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={input}
            required
          />
          <input
            type="password"
            placeholder="Passwort (min. 8 Zeichen)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className={btnPrimary}>
            Konto erstellen
          </button>
        </form>
        <p className="mt-4 text-sm text-gray-500">
          Schon ein Konto?{" "}
          <Link to="/login" className="font-medium text-black hover:underline">
            Anmelden
          </Link>
        </p>
      </div>
    </div>
  );
}
