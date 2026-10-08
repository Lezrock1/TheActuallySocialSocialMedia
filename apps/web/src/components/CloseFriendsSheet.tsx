import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { useCircles } from "../lib/circles.js";
import { useAuth } from "../auth/AuthContext.js";
import { input } from "../lib/ui.js";
import Avatar from "./Avatar.js";
import Sheet from "./Sheet.js";

// Own-profile overview: edit Close Friends and jump into your circles.
export default function CloseFriendsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const circlesQuery = useCircles();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeFriendsQuery = useQuery({
    queryKey: ["close-friends", "list"],
    queryFn: async () => (await apiFetch<{ users: PublicUser[] }>("/users/me/close-friends")).users,
    enabled: open,
  });
  const followingQuery = useQuery({
    queryKey: ["following", user?.username],
    queryFn: async () => (await apiFetch<{ users: PublicUser[] }>(`/users/${user!.username}/following`)).users,
    enabled: open && !!user,
    staleTime: 30_000,
  });

  const closeFriends = closeFriendsQuery.data ?? [];
  const closeIds = new Set(closeFriends.map((person) => person.id));
  const term = search.trim().replace(/^@/, "").toLocaleLowerCase();
  const candidates = (followingQuery.data ?? [])
    .filter((person) => !closeIds.has(person.id))
    .filter((person) => !term ||
      person.username.toLocaleLowerCase().includes(term) ||
      person.displayName?.toLocaleLowerCase().includes(term))
    .slice(0, 6);

  async function change(username: string, add: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/users/${encodeURIComponent(username)}/close-friend`, { method: add ? "POST" : "DELETE" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["close-friends"] }),
      ]);
      if (add) setSearch("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your close friends.");
    } finally {
      setBusy(false);
    }
  }

  const circles = circlesQuery.data?.circles ?? [];

  return (
    <Sheet open={open} onClose={onClose} title="Circles" tall>
      <section aria-label="Close friends">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Close friends</h3>
          <span className="text-xs tabular-nums text-gray-500">{closeFriends.length}</span>
        </div>
        <p className="mb-3 text-xs leading-5 text-gray-500">Only they see posts and stories you share with Close friends.</p>

        {closeFriends.length > 0 ? (
          <ul className="mb-3 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
            {closeFriends.map((person) => (
              <li key={person.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar avatarKey={person.avatarKey} username={person.username} size={34} />
                <Link to={`/u/${person.username}`} onClick={onClose} className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 hover:underline">
                  {person.displayName || `@${person.username}`}
                </Link>
                <button
                  type="button"
                  onClick={() => void change(person.username, false)}
                  disabled={busy}
                  aria-label={`Remove @${person.username} from close friends`}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500">
            {closeFriendsQuery.isLoading ? "Loading…" : "No close friends yet. Add people below."}
          </p>
        )}

        <label htmlFor="close-friends-search" className="mb-1 block text-xs font-semibold text-gray-600">Add someone</label>
        <input
          id="close-friends-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people you follow"
          className={`${input} w-full`}
        />
        {(term || candidates.length > 0) && (
          <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
            {candidates.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => void change(person.username, true)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
                >
                  <Avatar avatarKey={person.avatarKey} username={person.username} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm">{person.displayName || `@${person.username}`}</span>
                  <span className="text-sm font-semibold text-blue-600">Add</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="px-3 py-3 text-center text-xs text-gray-500">No matching people you follow.</li>
            )}
          </ul>
        )}
        {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      </section>

      <section aria-label="Your circles" className="mt-5 border-t border-gray-100 pt-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Your circles</h3>
          <Link to="/circles" onClick={onClose} className="text-xs font-semibold text-blue-600 hover:underline">Manage</Link>
        </div>
        {circles.length > 0 ? (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
            {circles.map((circle) => (
              <li key={circle.id}>
                <Link to="/circles" onClick={onClose} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-gray-50">
                  <span className="min-w-0 truncate font-medium text-gray-900">{circle.name}</span>
                  <span className="shrink-0 text-xs text-gray-500">{circle.memberCount} members</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500">No circles yet. Create one in Manage.</p>
        )}
      </section>
    </Sheet>
  );
}
