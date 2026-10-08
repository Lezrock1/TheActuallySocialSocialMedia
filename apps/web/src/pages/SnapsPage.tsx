import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboxSnap, PublicUser, SnapStreakSummary } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { downloadMediaBlob } from "../lib/upload.js";
import {
  decryptSnap,
  encryptSnap,
  getDeviceEncryptionKeys,
} from "../lib/encryption.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import Avatar from "../components/Avatar.js";
import PullToRefresh from "../components/PullToRefresh.js";
import EncryptionNotice from "../components/EncryptionNotice.js";
import { activityList, activityRow, card, formatActivityTime } from "../lib/ui.js";

async function fetchInbox(): Promise<InboxSnap[]> {
  const res = await apiFetch<{ snaps: InboxSnap[] }>("/snaps/inbox");
  return res.snaps;
}

async function fetchFollowing(username: string): Promise<PublicUser[]> {
  const res = await apiFetch<{ users: PublicUser[] }>(`/users/${username}/following`);
  return res.users;
}

async function fetchStreaks(): Promise<SnapStreakSummary[]> {
  const res = await apiFetch<{ streaks: SnapStreakSummary[] }>("/snaps/streaks");
  return res.streaks;
}

export default function SnapsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<InboxSnap | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [viewingText, setViewingText] = useState("");
  const [viewingIsVideo, setViewingIsVideo] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);

  const { data: snaps = [] } = useQuery({
    queryKey: ["snaps-inbox"],
    queryFn: fetchInbox,
  });
  const { data: following = [] } = useQuery({
    queryKey: ["following", user?.username],
    queryFn: () => fetchFollowing(user!.username),
    enabled: !!user,
  });
  const { data: streaks = [] } = useQuery({
    queryKey: ["snap-streaks"],
    queryFn: fetchStreaks,
  });

  const streakByFriend = new Map(streaks.map((streak) => [streak.friend.id, streak]));
  const friendsWithStreaks = following
    .map((friend) => ({ friend, streak: streakByFriend.get(friend.id) }))
    .sort((aEntry, bEntry) => {
      const waitingDifference = Number(bEntry.streak?.waitingForYou ?? false) -
        Number(aEntry.streak?.waitingForYou ?? false);
      if (waitingDifference) return waitingDifference;
      const currentDifference = (bEntry.streak?.currentStreak ?? 0) -
        (aEntry.streak?.currentStreak ?? 0);
      if (currentDifference) return currentDifference;
      return (aEntry.friend.displayName || aEntry.friend.username)
        .localeCompare(bEntry.friend.displayName || bEntry.friend.username);
    });

  useEffect(() => {
    return () => {
      if (viewingImageUrl) URL.revokeObjectURL(viewingImageUrl);
    };
  }, [viewingImageUrl]);

  useEffect(() => {
    if (!viewing || viewingIsVideo) return;
    const timeout = window.setTimeout(() => {
      setViewing(null);
      setViewingImageUrl(null);
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [viewing, viewingIsVideo]);

  async function openSnap(snap: InboxSnap) {
    setSnapError(null);
    try {
      let image = await downloadMediaBlob(snap.imageKey);
      let caption = snap.text ?? "";
      if (snap.isEncrypted) {
        if (!snap.encryptedPayload || !user) {
          throw new Error("Encrypted Snap data is missing or unavailable on this device.");
        }
        const localKeys = await getDeviceEncryptionKeys(user.id);
        const decrypted = await decryptSnap(image, snap.encryptedPayload, localKeys);
        image = decrypted.image;
        caption = decrypted.text;
      }
      await apiFetch(`/snaps/${snap.id}/view`, { method: "POST" });
      setViewingImageUrl(URL.createObjectURL(image));
      setViewingIsVideo(image.type.startsWith("video/"));
      setViewingText(caption);
      setViewing(snap);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["snaps-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["snaps", "unread-count"] }),
      ]);
    } catch (error) {
      setSnapError(error instanceof Error ? error.message : "Could not load this Snap. Please try again.");
    }
  }

  function closeSnap() {
    if (viewingImageUrl) URL.revokeObjectURL(viewingImageUrl);
    setViewingImageUrl(null);
    setViewingText("");
    setViewingIsVideo(false);
    setViewing(null);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-28 sm:py-8 sm:pb-8">
      <PullToRefresh enabled={!viewing} onRefresh={() => Promise.all([
        queryClient.invalidateQueries({ queryKey: ["snaps-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["snap-streaks"] }),
        queryClient.invalidateQueries({ queryKey: ["snaps", "unread-count"] }),
      ])} />
      <PageHeader title="Snaps" />
      <NavBar />
      <div className="mb-4">
        <p className="w-fit bg-[linear-gradient(90deg,#ef4444_0%,#f97316_20%,#eab308_40%,#22c55e_60%,#3b82f6_80%,#d946ef_100%)] bg-clip-text text-sm font-semibold text-transparent">
          Send a Snap, keep a streak going.
        </p>
      </div>

      <main className="flex min-w-0 flex-col gap-4">
        <aside className="flex min-w-0 flex-col gap-4">
          <section aria-label="Received Snaps" className={activityList}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-bold text-gray-900">Received</h2>
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-bold text-yellow-900">{snaps.length}</span>
            </div>
            {snapError && <p role="alert" className="px-4 pt-3 text-sm text-red-600">{snapError}</p>}
            <div className="max-h-80 overflow-y-auto">
              {snaps.map((snap) => (
                <button
                  key={snap.id}
                  onClick={() => void openSnap(snap)}
                  className={activityRow}
                >
                  <Avatar avatarKey={snap.sender.avatarKey} username={snap.sender.username} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">{snap.sender.displayName || `@${snap.sender.username}`}</span>
                    <span className="block text-xs text-gray-500">New Snap · {formatActivityTime(snap.createdAt)}</span>
                    {snap.isEncrypted && (
                      <span className="mt-1 block"><EncryptionNotice encrypted /></span>
                    )}
                  </span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#FFFC00] ring-1 ring-yellow-500/60" aria-label="Unopened" />
                </button>
              ))}
              {snaps.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500">You’re all caught up. New Snaps show up here.</p>
              )}
            </div>
          </section>

          <section aria-label="Snap streaks" className={activityList}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Your streaks</h2>
                <p className="mt-0.5 text-xs text-gray-500">All your contacts · reply to each other within 24 hours</p>
              </div>
              <span aria-hidden="true" className="text-xl">🔥</span>
            </div>
            <div>
              {friendsWithStreaks.map(({ friend, streak }) => (
                <Link
                  key={friend.id}
                  to={`/u/${friend.username}`}
                  className={activityRow}
                >
                  <Avatar avatarKey={friend.avatarKey} username={friend.username} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {friend.displayName || `@${friend.username}`}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {streak?.waitingForYou
                        ? "They sent a Snap. Send one back!"
                        : streak?.waitingForThem
                          ? "Your turn is done. Waiting for them."
                          : streak?.currentStreak
                            ? "Keep it going today"
                            : streak?.bestStreak
                              ? `No current streak · Best streak: ${streak.bestStreak}`
                              : "No current streak"}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-bold ${streak?.currentStreak ? "text-orange-600" : "text-gray-400"}`}>
                    🔥 {streak?.currentStreak ?? 0}
                  </span>
                </Link>
              ))}
              {friendsWithStreaks.length === 0 && (
                <p className="px-4 py-5 text-sm text-gray-500">Follow friends to see them here and start a Snap streak.</p>
              )}
            </div>
            {streaks.some((streak) => streak.bestStreak > 0) && (
              <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
                Best streaks are saved even after a current streak ends.
              </p>
            )}
          </section>
        </aside>
      </main>
      <p className="mt-4 text-[11px] leading-5 text-gray-500">
        When all recipient devices have keys, Snap content is encrypted on your device before upload, so the server cannot read it. The server can still see the sender, recipients, and view times.
      </p>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black"
          role="dialog"
          aria-modal="true"
          aria-label={`Snap from @${viewing.sender.username}`}
          onClick={closeSnap}
        >
          <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between border-b border-white/20 p-4 text-white" onClick={(event) => event.stopPropagation()}>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Avatar avatarKey={viewing.sender.avatarKey} username={viewing.sender.username} size={28} />
              {viewing.sender.displayName || `@${viewing.sender.username}`}
            </span>
            <button type="button" onClick={closeSnap} aria-label="Close Snap" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xl leading-none hover:bg-white/25">
              ×
            </button>
          </div>
          {viewingIsVideo ? (
            <video
              src={viewingImageUrl ?? undefined}
              autoPlay
              playsInline
              controls
              loop
              onClick={(event) => event.stopPropagation()}
              className="max-h-screen max-w-full object-contain"
            />
          ) : (
          <img
            src={viewingImageUrl ?? undefined}
            alt=""
            onClick={(event) => event.stopPropagation()}
            className="max-h-screen max-w-full object-contain"
          />
          )}
          {viewing.isEncrypted && (
            <div className="absolute left-4 top-16 rounded bg-black/70 px-2 py-1">
              <EncryptionNotice encrypted />
            </div>
          )}
          {viewingText && (
            <p className="absolute bottom-10 max-w-[90vw] rounded-full bg-black/60 px-4 py-2 text-center text-white">
              {viewingText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
