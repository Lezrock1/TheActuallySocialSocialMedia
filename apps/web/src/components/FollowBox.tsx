import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api.js";
import { card, input, btnSecondary } from "../lib/ui.js";

export default function FollowBox() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [lastTarget, setLastTarget] = useState<string | null>(null);

  async function onFollow(e: FormEvent) {
    e.preventDefault();
    const target = username.trim().replace(/^@/, "");
    if (!target) return;
    setStatus(null);
    try {
      await apiFetch(`/users/${target}/follow`, { method: "POST" });
      setStatus(`Du folgst jetzt @${target}`);
      setLastTarget(target);
      setUsername("");
      await queryClient.invalidateQueries({ queryKey: ["feed", "first"] });
    } catch (err) {
      setStatus(
        err instanceof ApiError ? err.message : "Folgen fehlgeschlagen"
      );
    }
  }

  return (
    <form onSubmit={(e) => void onFollow(e)} className={`${card} mb-6 flex items-center gap-2`}>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Nutzername folgen oder Profil ansehen"
        className={`${input} w-full`}
      />
      <button className={btnSecondary}>Folgen</button>
      {username.trim() && (
        <Link
          to={`/u/${username.trim().replace(/^@/, "")}`}
          className="shrink-0 text-xs text-gray-500 hover:underline"
        >
          Profil ansehen
        </Link>
      )}
      {status && lastTarget && (
        <Link to={`/u/${lastTarget}`} className="shrink-0 text-xs text-gray-500 hover:underline">
          {status}
        </Link>
      )}
    </form>
  );
}
