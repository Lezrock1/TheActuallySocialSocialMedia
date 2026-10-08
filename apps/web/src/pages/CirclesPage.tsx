import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CircleDetail, PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { useCircles } from "../lib/circles.js";
import { useAuth } from "../auth/AuthContext.js";
import { activityList, activityRow, btnPrimary, btnSecondary, card, input } from "../lib/ui.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import Avatar from "../components/Avatar.js";
import Sheet from "../components/Sheet.js";
import AppDialog from "../components/AppDialog.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";

function CircleSheet({ circleId, onClose }: { circleId: string; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["circle", circleId],
    queryFn: async () => (await apiFetch<{ circle: CircleDetail }>(`/circles/${circleId}`)).circle,
  });
  const followingQuery = useQuery({
    queryKey: ["following", user?.username],
    queryFn: async () => (await apiFetch<{ users: PublicUser[] }>(`/users/${user!.username}/following`)).users,
    enabled: !!user,
    staleTime: 30_000,
  });
  const circle = detailQuery.data;
  const memberIds = new Set(circle?.members.map((member) => member.id));
  const term = search.trim().replace(/^@/, "").toLocaleLowerCase();
  const candidates = (followingQuery.data ?? [])
    .filter((person) => !memberIds.has(person.id))
    .filter((person) => !term ||
      person.username.toLocaleLowerCase().includes(term) ||
      person.displayName?.toLocaleLowerCase().includes(term))
    .slice(0, 8);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["circle", circleId] }),
      queryClient.invalidateQueries({ queryKey: ["circles"] }),
      queryClient.invalidateQueries({ queryKey: ["circles-containing"] }),
    ]);
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function addMember(username: string) {
    void run(async () => {
      await apiFetch(`/circles/${circleId}/members`, { method: "POST", body: JSON.stringify({ username }) });
      setSearch("");
    });
  }

  function removeMember(username: string) {
    void run(() => apiFetch(`/circles/${circleId}/members/${encodeURIComponent(username)}`, { method: "DELETE" }));
  }

  function rename(event: FormEvent) {
    event.preventDefault();
    const next = (name ?? circle?.name ?? "").trim();
    if (!next || next === circle?.name) return;
    void run(async () => {
      await apiFetch(`/circles/${circleId}`, { method: "PATCH", body: JSON.stringify({ name: next }) });
      setName(null);
    });
  }

  async function deleteCircle() {
    setBusy(true);
    try {
      await apiFetch(`/circles/${circleId}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["circles"] });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this circle.");
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet open onClose={onClose} title={circle?.name ?? "Circle"} tall>
        {detailQuery.isLoading && <CardListSkeleton rows={2} />}
        {circle && (
          <div className="flex flex-col gap-4">
            <form onSubmit={rename} className="flex gap-2">
              <input
                value={name ?? circle.name}
                maxLength={30}
                onChange={(event) => setName(event.target.value)}
                aria-label="Circle name"
                className={`${input} min-w-0 flex-1`}
              />
              <button disabled={busy || !name || name.trim() === circle.name} className={btnSecondary}>Rename</button>
            </form>

            <section aria-label="Members">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Members ({circle.members.length})
              </h3>
              {circle.members.length === 0 ? (
                <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500">No one yet. Add people below.</p>
              ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
                  {circle.members.map((member) => (
                    <li key={member.id} className="flex items-center gap-3 px-3 py-2">
                      <Avatar avatarKey={member.avatarKey} username={member.username} size={34} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                        {member.displayName || `@${member.username}`}
                        {member.displayName && <span className="ml-1 text-xs font-normal text-gray-500">@{member.username}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMember(member.username)}
                        disabled={busy}
                        className="rounded-full px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Add people">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Add people</h3>
              <input
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
                      onClick={() => addMember(person.username)}
                      disabled={busy}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Avatar avatarKey={person.avatarKey} username={person.username} size={34} />
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                        {person.displayName || `@${person.username}`}
                      </span>
                      <span className="text-lg text-blue-600">+</span>
                    </button>
                  </li>
                ))}
                {term && !candidates.some((person) => person.username.toLocaleLowerCase() === term) && (
                  <li>
                    <button
                      type="button"
                      onClick={() => addMember(term)}
                      disabled={busy}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gray-100 text-gray-500">@</span>
                      Add @{term}
                    </button>
                  </li>
                )}
                {!term && candidates.length === 0 && (
                  <li className="px-3 py-3 text-sm text-gray-500">Everyone you follow is already in this circle.</li>
                )}
              </ul>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                People you add are notified and can see what you share with this circle, even if they don't follow you.
              </p>
            </section>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="self-start text-sm font-medium text-red-600 hover:underline"
            >
              Delete circle
            </button>
          </div>
        )}
      </Sheet>
      <AppDialog
        open={confirmDelete}
        title="Delete this circle?"
        description="Posts and stories you shared with it stay, but only you will be able to see them."
        confirmLabel="Delete"
        danger
        pending={busy}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void deleteCircle()}
      />
    </>
  );
}

export default function CirclesPage() {
  const queryClient = useQueryClient();
  const circlesQuery = useCircles();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const circles = circlesQuery.data?.circles ?? [];
  const max = circlesQuery.data?.maxCircles ?? 10;

  async function createCircle(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const result = await apiFetch<{ circle: { id: string } }>("/circles", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewName("");
      await queryClient.invalidateQueries({ queryKey: ["circles"] });
      setOpenId(result.circle.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the circle.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Circles" />
      <NavBar />
      <p className="mb-4 text-sm leading-6 text-gray-600">
        Circles are small groups like Family or Uni. Posts and stories you share with a circle are only visible to its members.
        Your <span className="font-medium text-gray-800">Close friends</span> list keeps working as before.
      </p>

      <form onSubmit={(event) => void createCircle(event)} className={`${card} mb-4 flex flex-col gap-3`}>
        <label htmlFor="new-circle" className="text-sm font-semibold text-gray-900">New circle</label>
        <div className="flex gap-2">
          <input
            id="new-circle"
            value={newName}
            maxLength={30}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Family, Uni, Football…"
            disabled={circles.length >= max}
            className={`${input} min-w-0 flex-1`}
          />
          <button disabled={creating || !newName.trim() || circles.length >= max} className={btnPrimary}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {circles.length >= max && <p className="text-xs text-gray-500">You reached the limit of {max} circles.</p>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </form>

      {circlesQuery.isLoading && <CardListSkeleton rows={2} />}
      {circlesQuery.isError && <p role="alert" className="text-sm text-red-600">Could not load your circles.</p>}
      {circles.length > 0 && (
        <div className={activityList}>
          {circles.map((circle) => (
            <button key={circle.id} type="button" onClick={() => setOpenId(circle.id)} className={activityRow}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold text-white">
                {circle.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900">{circle.name}</span>
                <span className="block text-xs text-gray-500">
                  {circle.memberCount} {circle.memberCount === 1 ? "member" : "members"}
                </span>
              </span>
              <span aria-hidden="true" className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}
      {!circlesQuery.isLoading && circles.length === 0 && (
        <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-gray-500 shadow-sm">
          No circles yet. Create your first one above.
        </p>
      )}

      {openId && <CircleSheet circleId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
