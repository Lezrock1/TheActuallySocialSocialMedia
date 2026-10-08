import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CircleDetail, PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { useCircles } from "../lib/circles.js";
import { useAuth } from "../auth/AuthContext.js";
import { btnPrimary, input } from "../lib/ui.js";
import Avatar from "./Avatar.js";
import Sheet from "./Sheet.js";

export default function CircleMemberManagerSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const circlesQuery = useCircles();
  const circles = circlesQuery.data?.circles ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedId = activeId && circles.some((circle) => circle.id === activeId)
    ? activeId
    : circles[0]?.id ?? null;

  const circleQuery = useQuery({
    queryKey: ["circle", selectedId],
    queryFn: async () => (await apiFetch<{ circle: CircleDetail }>(`/circles/${selectedId}`)).circle,
    enabled: open && !!selectedId,
  });
  const followingQuery = useQuery({
    queryKey: ["following", user?.username],
    queryFn: async () => (await apiFetch<{ users: PublicUser[] }>(`/users/${user!.username}/following`)).users,
    enabled: open && !!user,
    staleTime: 30_000,
  });

  const circle = circleQuery.data;
  const memberIds = new Set(circle?.members.map((member) => member.id));
  const query = search.trim().replace(/^@/, "").toLocaleLowerCase();
  const candidates = (followingQuery.data ?? []).filter((person) =>
    !memberIds.has(person.id) && (!query || person.username.toLocaleLowerCase().includes(query) || person.displayName?.toLocaleLowerCase().includes(query))
  ).slice(0, 8);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["circles"] }),
      queryClient.invalidateQueries({ queryKey: ["circle", selectedId] }),
      queryClient.invalidateQueries({ queryKey: ["circles-containing"] }),
    ]);
  }

  async function createCircle() {
    const value = name.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ circle: { id: string } }>("/circles", {
        method: "POST",
        body: JSON.stringify({ name: value }),
      });
      setName("");
      setActiveId(result.circle.id);
      await queryClient.invalidateQueries({ queryKey: ["circles"] });
      await queryClient.invalidateQueries({ queryKey: ["circle", result.circle.id] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create this circle.");
    } finally {
      setBusy(false);
    }
  }

  async function mutateMember(username: string, add: boolean) {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      if (add) {
        await apiFetch(`/circles/${selectedId}/members`, { method: "POST", body: JSON.stringify({ username }) });
      } else {
        await apiFetch(`/circles/${selectedId}/members/${encodeURIComponent(username)}`, { method: "DELETE" });
      }
      await refresh();
      if (add) setSearch("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update circle members.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Manage circles" tall>
      <p className="mb-3 text-xs leading-5 text-gray-500">
        Add the people who should see this post or story. They’re notified when added.
      </p>

      {circles.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {circles.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveId(item.id)}
              aria-pressed={selectedId === item.id}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedId === item.id ? "border-black bg-black text-white" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}
            >
              {item.name} · {item.memberCount}
            </button>
          ))}
        </div>
      )}

      {circle && (
        <>
          <div className="mb-3 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs leading-5 text-indigo-900">
            <strong>{circle.memberCount} {circle.memberCount === 1 ? "member" : "members"} + you</strong> will be able to see this share.
          </div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Members</h3>
          {circle.members.length > 0 ? (
            <ul className="mb-4 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
              {circle.members.map((member) => (
                <li key={member.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar avatarKey={member.avatarKey} username={member.username} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900">@{member.username}</span>
                  <button
                    type="button"
                    onClick={() => void mutateMember(member.username, false)}
                    disabled={busy}
                    aria-label={`Remove @${member.username}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500">Only you can see this circle so far.</p>
          )}
          <label htmlFor="circle-manager-search" className="mb-1 block text-xs font-semibold text-gray-600">Add someone</label>
          <input
            id="circle-manager-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people you follow or type @username"
            className={`${input} w-full`}
          />
          <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
            {candidates.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => void mutateMember(person.username, true)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
                >
                  <Avatar avatarKey={person.avatarKey} username={person.username} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm">@{person.username}</span>
                  <span className="text-sm font-semibold text-blue-600">Add</span>
                </button>
              </li>
            ))}
            {query && !candidates.some((person) => person.username.toLowerCase() === query) && (
              <li>
                <button type="button" onClick={() => void mutateMember(query, true)} disabled={busy} className="flex min-h-10 w-full items-center gap-3 px-3 text-left text-sm hover:bg-gray-50 disabled:opacity-50">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500">@</span>
                  Add @{query}
                </button>
              </li>
            )}
          </ul>
        </>
      )}

      {circles.length < (circlesQuery.data?.maxCircles ?? 10) && (
        <form
          onSubmit={(event) => { event.preventDefault(); void createCircle(); }}
          className="mt-4 flex gap-2 border-t border-gray-100 pt-4"
        >
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} placeholder="New circle name" className={`${input} min-w-0 flex-1`} />
          <button type="submit" disabled={busy || !name.trim()} className={btnPrimary}>Create</button>
        </form>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
    </Sheet>
  );
}
