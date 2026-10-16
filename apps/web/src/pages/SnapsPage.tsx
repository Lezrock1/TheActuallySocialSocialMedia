import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
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
import DecodedImage from "../components/DecodedImage.js";
import PlaybackProgress from "../components/PlaybackProgress.js";
import CameraIcon from "../components/CameraIcon.js";
import { activityList, activityRow, card, formatActivityTime } from "../lib/ui.js";

interface SnapInboxData {
  snaps: InboxSnap[];
  recentlyViewed: InboxSnap[];
}

async function fetchInbox(): Promise<SnapInboxData> {
  return apiFetch<SnapInboxData>("/snaps/inbox");
}

async function fetchFollowing(username: string): Promise<PublicUser[]> {
  const res = await apiFetch<{ users: PublicUser[] }>(`/users/${username}/following`);
  return res.users;
}

async function fetchStreaks(): Promise<SnapStreakSummary[]> {
  const res = await apiFetch<{ streaks: SnapStreakSummary[] }>("/snaps/streaks");
  return res.streaks;
}

function waitingWindowLabel(lastExchangeAt: string | null, nowMs: number): string | null {
  if (!lastExchangeAt) return null;
  const remainingMs = Date.parse(lastExchangeAt) + 24 * 60 * 60 * 1000 - nowMs;
  if (remainingMs <= 0) return "now";
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

export default function SnapsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<InboxSnap | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [viewingImageBlob, setViewingImageBlob] = useState<Blob | null>(null);
  const [viewingText, setViewingText] = useState("");
  const [viewingIsVideo, setViewingIsVideo] = useState(false);
  const [viewerRevealed, setViewerRevealed] = useState(false);
  const [snapHeld, setSnapHeld] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const [videoMuted, setVideoMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const openingRequestRef = useRef(0);
  const markedSnapsRef = useRef(new Set<string>());
  const prefetchRef = useRef(new Map<string, { promise: Promise<Blob>; controller: AbortController; startedAt: number }>());
  const [snapClosing, setSnapClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const [openingSnapId, setOpeningSnapId] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragX, setDragX] = useState(0);
  const dragRef = useRef<{ startY: number; startX: number; startedAt: number; moved: boolean; mode: "x" | "y" | null } | null>(null);
  const suppressClickRef = useRef(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [quickReplyText, setQuickReplyText] = useState("");
  const [quickReplyBusy, setQuickReplyBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const { data: inbox } = useQuery({
    queryKey: ["snaps-inbox"],
    queryFn: fetchInbox,
  });
  const snaps = inbox?.snaps ?? [];
  const inboxRows = snaps.filter((snap, index) => snaps.findIndex((candidate) => candidate.sender.id === snap.sender.id) === index);
  useEffect(() => {
    const upcoming = (inbox?.snaps ?? []).filter((snap) => !markedSnapsRef.current.has(snap.id)).slice(0, 2);
    const keys = new Set(upcoming.map((snap) => snap.imageKey));
    for (const [key, pending] of prefetchRef.current) {
      if (!keys.has(key)) { pending.controller.abort(); prefetchRef.current.delete(key); }
    }
    for (const snap of upcoming) {
      if (prefetchRef.current.has(snap.imageKey)) continue;
      const controller = new AbortController();
      const promise = downloadMediaBlob(snap.imageKey, controller.signal);
      prefetchRef.current.set(snap.imageKey, { promise, controller, startedAt: Date.now() });
      void promise.catch(() => {
        if (prefetchRef.current.get(snap.imageKey)?.controller === controller) prefetchRef.current.delete(snap.imageKey);
      });
    }
  }, [inbox]);
  const seenToday = inbox?.recentlyViewed ?? [];
  const { data: following = [], isLoading: followingLoading } = useQuery({
    queryKey: ["following", user?.username],
    queryFn: () => fetchFollowing(user!.username),
    enabled: !!user,
  });
  const { data: streaks = [], isLoading: streaksLoading } = useQuery({
    queryKey: ["snap-streaks"],
    queryFn: fetchStreaks,
  });

  const streakByFriend = new Map(streaks.map((streak) => [streak.friend.id, streak]));
  const waitingForYouCount = streaks.filter((streak) => streak.waitingForYou).length;
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
  const waitingFriends = friendsWithStreaks.filter(({ streak }) => streak?.waitingForYou);
  const activeStreakCount = streaks.filter((streak) => streak.currentStreak > 0).length;
  const dedupedSeenToday = useMemo(() => {
    const unreadIds = new Set(snaps.map((snap) => snap.id));
    return seenToday.filter((snap) => !unreadIds.has(snap.id));
  }, [seenToday, snaps]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (viewingImageUrl) URL.revokeObjectURL(viewingImageUrl);
    };
  }, [viewingImageUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (snapHeld || replyFocused || quickReplyBusy || document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [snapHeld, replyFocused, quickReplyBusy, viewingImageUrl]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && viewing && !snapClosing) closeSnap();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewing, snapClosing]);

  useEffect(() => () => {
    openingRequestRef.current += 1;
    for (const pending of prefetchRef.current.values()) pending.controller.abort();
    prefetchRef.current.clear();
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  async function openSnap(snap: InboxSnap) {
    if (openingSnapId) return;
    const requestId = ++openingRequestRef.current;
    setOpeningSnapId(snap.id);
    setViewing(null);
    setViewingImageUrl(null);
    setViewingImageBlob(null);
    setSnapError(null);
    try {
      const prefetched = prefetchRef.current.get(snap.imageKey);
      let image = await (prefetched && Date.now() - prefetched.startedAt < 30_000 ? prefetched.promise : downloadMediaBlob(snap.imageKey));
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
      if (requestId !== openingRequestRef.current) return;
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      setViewingImageUrl(URL.createObjectURL(image));
      setViewingImageBlob(image);
      setViewingIsVideo(image.type.startsWith("video/"));
      setViewingText(caption);
      setViewerRevealed(false);
      setSnapClosing(false);
      setDragY(0);
      setDragX(0);
      setQuickReplyText("");
      setReplyFocused(false);
      setSnapHeld(false);
      setViewing(snap);
    } catch (error) {
      if (requestId === openingRequestRef.current) setSnapError(error instanceof Error ? error.message : "Could not load this Snap. Please try again.");
    } finally {
      if (requestId === openingRequestRef.current) setOpeningSnapId(null);
    }
  }

  function revealSnap() {
    if (!viewing) return;
    setViewerRevealed(true);
    if (markedSnapsRef.current.has(viewing.id)) return;
    const snapId = viewing.id;
    markedSnapsRef.current.add(snapId);
    void apiFetch(`/snaps/${snapId}/view`, { method: "POST" }).then(() => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["snaps-inbox"] }),
      queryClient.invalidateQueries({ queryKey: ["snaps", "unread-count"] }),
    ])).catch(() => {
      markedSnapsRef.current.delete(snapId);
      setSnapError("Could not sync this Snap's view status.");
    });
  }

  function advanceSnap() {
    if (!viewing || snapClosing) return;
    const remaining = snaps.filter((snap) => snap.id !== viewing.id && !markedSnapsRef.current.has(snap.id));
    const next = remaining.find((snap) => snap.sender.id === viewing.sender.id) ?? remaining[0];
    if (next) void openSnap(next);
    else closeSnap();
  }

  function closeSnap() {
    if (openingSnapId) {
      openingRequestRef.current += 1;
      setOpeningSnapId(null);
    }
    if (!viewing || snapClosing) return;
    setSnapClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setViewingImageUrl(null);
      setViewingImageBlob(null);
      setViewingText("");
      setViewingIsVideo(false);
      setViewing(null);
      setViewerRevealed(false);
      setSnapClosing(false);
      setDragY(0);
      setDragX(0);
      setQuickReplyText("");
      closeTimerRef.current = null;
    }, 220);
  }

  async function quickReply(message: string) {
    if (!viewing || !viewingImageBlob || !message.trim() || quickReplyBusy) return;
    setQuickReplyBusy(true);
    try {
      const result = await apiFetch<{ conversationId: string }>("/conversations", {
        method: "POST",
        body: JSON.stringify({ username: viewing.sender.username }),
      });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      closeSnap();
      navigate(`/dms?conversation=${result.conversationId}`, {
        state: { draftMessage: message.trim(), snapReply: {
          snapId: viewing.id,
          authorUsername: viewing.sender.username,
          createdAt: viewing.createdAt,
          image: viewingImageBlob,
        } },
      });
    } catch {
      setSnapError("Could not open quick reply. Please try again.");
    } finally {
      setQuickReplyBusy(false);
    }
  }

  function onViewerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (snapClosing || (event.target as HTMLElement).closest("[data-snap-controls]")) return;
    suppressClickRef.current = false;
    setSnapHeld(true);
    dragRef.current = { startY: event.clientY, startX: event.clientX, startedAt: performance.now(), moved: false, mode: null };
  }

  function onViewerPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaY = event.clientY - drag.startY;
    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) drag.moved = true;
    if (!drag.moved) return;

    if (!drag.mode) drag.mode = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
    if (drag.mode === "x") {
      setDragX(Math.max(0, deltaX));
      setDragY(0);
    } else {
      setDragY(Math.max(0, deltaY));
      setDragX(0);
    }
  }

  function onViewerPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    setSnapHeld(false);
    if (drag && performance.now() - drag.startedAt > 220) suppressClickRef.current = true;
    if (!drag?.moved) return;
    suppressClickRef.current = true;
    if ((drag.mode === "x" && dragX > 95) || event.clientY - drag.startY < -80) {
      setDragX(0);
      replyInputRef.current?.focus();
      return;
    }
    if (drag.mode === "y" && dragY > 110) closeSnap();
    else {
      setDragY(0);
      setDragX(0);
    }
  }

  const dragStyle: React.CSSProperties | undefined = (dragY > 0 || dragX > 0) && !snapClosing
    ? {
        transform: `translate(${dragX}px, ${dragY}px) scale(${Math.max(0.85, 1 - Math.max(dragY, dragX) / 1400)})`,
        animation: "none",
      }
    : undefined;

  function startFriendLongPress(username: string) {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      navigate(`/snaps?camera=1&snapTo=${encodeURIComponent(username)}`);
    }, 500);
  }

  function cancelFriendLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
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

      <main className="flex min-w-0 flex-col gap-4">
        <aside className="flex min-w-0 flex-col gap-4">
          <section aria-label="Your turn" className={`${activityList} border-emerald-200`}>
            <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50/70 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Your turn</h2>
                <p className="mt-0.5 text-xs text-gray-600">
                  {streaksLoading || followingLoading
                    ? "Checking your streaks..."
                    : waitingFriends.length > 0
                    ? "A quick reply keeps the streak going."
                    : "A little back-and-forth keeps streaks alive."}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${waitingFriends.length > 0 ? "bg-emerald-700 text-white" : "border border-emerald-200 bg-white text-emerald-800"}`}>
                {streaksLoading || followingLoading
                  ? "Checking"
                  : waitingFriends.length > 0 ? `${waitingFriends.length} waiting` : "On track"}
              </span>
            </div>
            {streaksLoading || followingLoading ? (
              <p className="px-4 py-4 text-sm text-gray-500">Checking your streaks...</p>
            ) : waitingFriends.length > 0 ? (
              <div>
                {waitingFriends.slice(0, 3).map(({ friend, streak }) => {
                  const remaining = waitingWindowLabel(streak?.lastExchangeAt ?? null, nowMs);
                  return (
                    <div key={friend.id} className="flex min-h-[66px] items-center gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0 sm:px-4">
                      <Avatar avatarKey={friend.avatarKey} username={friend.username} size={42} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-gray-900">
                          {friend.displayName || `@${friend.username}`}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500">
                          {remaining === "now" ? "Reply window ending" : `Reply within ${remaining ?? "24h"}`}
                          {streak?.currentStreak ? ` · 🔥 ${streak.currentStreak} day streak` : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/snaps?camera=1&snapTo=${encodeURIComponent(friend.username)}`)}
                        aria-label={`Send a Snap to @${friend.username}`}
                        className="min-h-9 shrink-0 rounded-full bg-emerald-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                      >
                        Send Snap
                      </button>
                    </div>
                  );
                })}
                {waitingFriends.length > 3 && (
                  <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
                    +{waitingFriends.length - 3} more waiting
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-4">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700">✓</span>
                <p className="min-w-0 text-sm text-gray-700">
                  You’re all caught up.
                  <span className="mt-0.5 block text-xs text-gray-500">
                    {activeStreakCount > 0
                      ? `${activeStreakCount} active ${activeStreakCount === 1 ? "streak is" : "streaks are"} on track.`
                      : "No one is waiting for a Snap right now."}
                  </span>
                </p>
              </div>
            )}
          </section>

          <section aria-label="Received Snaps" className={activityList}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-bold text-gray-900">New Snaps</h2>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">{snaps.length} new</span>
            </div>
            {snapError && <p role="alert" className="px-4 pt-3 text-sm text-red-600">{snapError}</p>}
            <div>
              {inboxRows.map((snap) => (
                <button
                  key={snap.id}
                  onClick={() => void openSnap(snap)}
                  disabled={!!openingSnapId}
                  aria-busy={openingSnapId === snap.id}
                  className={activityRow}
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-yellow-400 bg-white p-0.5">
                    <Avatar avatarKey={snap.sender.avatarKey} username={snap.sender.username} size={40} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">{snap.sender.displayName || `@${snap.sender.username}`}</span>
                    <span className="block text-xs text-gray-500">New Snap · {snaps.filter((item) => item.sender.id === snap.sender.id).length > 1 ? `${snaps.filter((item) => item.sender.id === snap.sender.id).length} unread · ` : ""}{formatActivityTime(snap.createdAt)}</span>
                    {snap.isEncrypted && (
                      <span className="mt-1 block"><EncryptionNotice encrypted /></span>
                    )}
                  </span>
                  {openingSnapId === snap.id ? (
                    <span aria-label="Opening" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
                  ) : (
                    <span className="sr-only">Unopened</span>
                  )}
                </button>
              ))}
              {snaps.length === 0 && (
                <p className="px-4 py-4 text-sm text-gray-500">You’re all caught up. New Snaps show up here.</p>
              )}

              <div className="px-4 pb-1 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Today’s activity</p>
              </div>
              {dedupedSeenToday.map((snap) => (
                <div key={`seen-${snap.id}`} className="flex min-h-[58px] items-center gap-3 border-t border-gray-100 px-4 py-2.5">
                  <Avatar avatarKey={snap.sender.avatarKey} username={snap.sender.username} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-800">{snap.sender.displayName || `@${snap.sender.username}`}</span>
                    <span className="block text-xs text-gray-500">Seen {formatActivityTime(snap.viewedAt || snap.createdAt)} · streak-relevant</span>
                  </span>
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500">Seen</span>
                </div>
              ))}
              {dedupedSeenToday.length === 0 && (
                <p className="px-4 pb-5 pt-1 text-xs text-gray-500">Seen Snaps from today appear here to keep streak context clear.</p>
              )}
            </div>
          </section>

          <details aria-label="All Snap streaks" className={`${activityList} group`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 [&::-webkit-details-marker]:hidden">
              <div>
                <h2 className="text-sm font-bold text-gray-900">All streaks</h2>
                <p className="mt-0.5 text-xs text-gray-500">Your friends and their current streaks</p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span aria-hidden="true" className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-bold text-orange-700">
                {waitingForYouCount > 0 ? `${waitingForYouCount} waiting` : "🔥 Active"}
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </span>
            </summary>
            <div>
              {friendsWithStreaks.map(({ friend, streak }) => (
                <button
                  key={friend.id}
                  type="button"
                  onPointerDown={() => startFriendLongPress(friend.username)}
                  onPointerUp={cancelFriendLongPress}
                  onPointerCancel={cancelFriendLongPress}
                  onPointerLeave={cancelFriendLongPress}
                  onClick={() => {
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false;
                      return;
                    }
                    navigate(`/u/${friend.username}`);
                  }}
                  className={activityRow}
                >
                  <Avatar avatarKey={friend.avatarKey} username={friend.username} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {friend.displayName || `@${friend.username}`}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {streak?.waitingForYou
                        ? `They sent a Snap. Reply in ${waitingWindowLabel(streak.lastExchangeAt, nowMs) ?? "time"}.`
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
                </button>
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
          </details>
        </aside>
      </main>
      <details className="mt-4 text-[11px] leading-5 text-gray-500">
        <summary className="w-fit cursor-pointer font-medium text-gray-500 underline decoration-gray-300 underline-offset-2">Snap privacy</summary>
        <p className="mt-1.5 max-w-2xl">
          When all recipient devices have keys, Snap content is encrypted on your device before upload, so the server cannot read it. The server can still see the sender, recipients, and view times.
        </p>
      </details>

      {openingSnapId && createPortal(<div role="dialog" aria-modal="true" aria-label="Opening Snap" className="fixed inset-0 z-[60] flex items-center justify-center bg-black text-white">
        <span role="status" aria-label="Loading Snap" className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <button type="button" aria-label="Cancel opening Snap" onClick={closeSnap} className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center text-2xl">×</button>
      </div>, document.body)}
      {viewing && createPortal(
        <div
          className={`fixed inset-0 z-50 flex touch-none select-none flex-col items-center justify-center bg-black ${snapClosing ? "snap-viewer-exit" : ""}`}
          style={(dragY > 0 || dragX > 0) && !snapClosing
            ? { backgroundColor: `rgba(0,0,0,${Math.max(0.35, 1 - Math.max(dragY, dragX) / 500)})`, animation: "none" }
            : undefined}
          role="dialog"
          aria-modal="true"
          aria-label={`Snap from @${viewing.sender.username}`}
          onClick={() => { if (!suppressClickRef.current) advanceSnap(); }}
          onPointerDown={onViewerPointerDown}
          onPointerMove={onViewerPointerMove}
          onPointerUp={onViewerPointerEnd}
          onPointerCancel={onViewerPointerEnd}
        >
          {!viewingIsVideo && !snapClosing && (
            <span key={viewing.id} className="pointer-events-none absolute inset-x-4 top-[max(0.5rem,env(safe-area-inset-top))] z-20 h-[3px] overflow-hidden rounded-full">
              <PlaybackProgress label="Snap progress" durationMs={10_000} ready={viewerRevealed} paused={snapHeld || replyFocused || quickReplyBusy} onComplete={advanceSnap} />
            </span>
          )}
          <div data-snap-controls className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/30 to-transparent px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))] text-white" onClick={(event) => event.stopPropagation()}>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Avatar avatarKey={viewing.sender.avatarKey} username={viewing.sender.username} size={28} />
              {viewing.sender.displayName || `@${viewing.sender.username}`}
            </span>
            <button type="button" onClick={closeSnap} aria-label="Close Snap" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xl leading-none hover:bg-white/25">
              ×
            </button>
          </div>
          {dragX > 0 && !snapClosing && (
            <div className="pointer-events-none absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/18 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
              Swipe right to reply
            </div>
          )}
          {viewingIsVideo ? (
            <video
              key={viewing.id}
              ref={videoRef}
              aria-label={`Snap video from @${viewing.sender.username}`}
              src={viewingImageUrl ?? undefined}
              autoPlay
              playsInline
              muted={videoMuted}
              onLoadedData={revealSnap}
              onEnded={advanceSnap}
              style={dragStyle}
              className={`max-h-[100dvh] max-w-full object-contain ${snapClosing ? "snap-media-exit" : ""}`}
            />
          ) : (
          <DecodedImage
            key={viewing.id}
            src={viewingImageUrl!}
            alt={`Snap from @${viewing.sender.username}`}
            onReady={revealSnap}
            className={`h-[100dvh] w-full ${snapClosing ? "snap-media-exit" : ""}`}
          />
          )}
          {viewing.isEncrypted && (
            <div className="absolute left-4 top-[calc(max(1rem,env(safe-area-inset-top))+3.25rem)] z-10 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-green-300 backdrop-blur-md" onClick={(event) => event.stopPropagation()}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
              End-to-end encrypted
            </div>
          )}
          {viewingText && (
            <p className="absolute bottom-[9.25rem] max-w-[90vw] rounded-full bg-black/60 px-4 py-2 text-center text-white">
              {viewingText}
            </p>
          )}
          <div data-snap-controls className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-14" onClick={(event) => event.stopPropagation()}>
            {viewingIsVideo && <button type="button" onClick={() => setVideoMuted((current) => !current)} aria-label={videoMuted ? "Turn Snap sound on" : "Turn Snap sound off"} className="mb-2 rounded-full bg-black/40 px-3 py-2 text-xs text-white">{videoMuted ? "Sound on" : "Mute"}</button>}
            {snapError && <p role="alert" className="mb-2 text-xs text-white">{snapError}</p>}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {[
                "Bin dabei",
                "Später",
                "😂",
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => void quickReply(chip)}
                  disabled={quickReplyBusy}
                  className="min-h-8 rounded-full border border-white/35 bg-white/10 px-3 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-white/20 disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void quickReply(quickReplyText);
              }}
              className="flex items-center gap-2"
            >
              <button type="button" aria-label="Reply with a Snap" onClick={() => { const username = viewing.sender.username; closeSnap(); navigate(`/snaps?camera=1&snapTo=${encodeURIComponent(username)}`); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/35 text-white"><CameraIcon /></button>
              <input
                ref={replyInputRef}
                value={quickReplyText}
                onFocus={() => setReplyFocused(true)}
                onBlur={() => setReplyFocused(false)}
                onChange={(event) => setQuickReplyText(event.target.value)}
                placeholder="Quick reply"
                maxLength={4000}
                className="min-h-10 min-w-0 flex-1 rounded-full border border-white/35 bg-black/25 px-4 text-sm text-white placeholder:text-white/70 focus:border-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={!quickReplyText.trim() || quickReplyBusy}
                className="min-h-10 rounded-full bg-white px-4 text-xs font-semibold text-black disabled:opacity-50"
              >
                {quickReplyBusy ? "..." : "Reply"}
              </button>
            </form>
          </div>
        </div>, document.body
      )}
    </div>
  );
}
