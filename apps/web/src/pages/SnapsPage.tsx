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
import { card, formatActivityTime } from "../lib/ui.js";

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
  const [friendSearch, setFriendSearch] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "unread" | "streaks">("all");
  const [openingChat, setOpeningChat] = useState<string | null>(null);

  const { data: inbox, isLoading: inboxLoading, isError: inboxFailed, refetch: retryInbox } = useQuery({
    queryKey: ["snaps-inbox"],
    queryFn: fetchInbox,
  });
  const snaps = inbox?.snaps ?? [];
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
  const { data: following = [], isLoading: followingLoading, isError: followingFailed, refetch: retryFollowing } = useQuery({
    queryKey: ["following", user?.username],
    queryFn: () => fetchFollowing(user!.username),
    enabled: !!user,
  });
  const { data: streaks = [] } = useQuery({
    queryKey: ["snap-streaks"],
    queryFn: fetchStreaks,
  });

  const streakByFriend = new Map(streaks.map((streak) => [streak.friend.id, streak]));
  const dedupedSeenToday = useMemo(() => {
    const unreadIds = new Set(snaps.map((snap) => snap.id));
    return seenToday.filter((snap) => !unreadIds.has(snap.id));
  }, [seenToday, snaps]);
  const snapFriends = [...new Map([...following, ...snaps.map((snap) => snap.sender), ...seenToday.map((snap) => snap.sender)].map((friend) => [friend.id, friend])).values()]
    .map((friend) => ({ friend, snap: snaps.find((snap) => snap.sender.id === friend.id), seen: dedupedSeenToday.find((snap) => snap.sender.id === friend.id), streak: streakByFriend.get(friend.id) }))
    .filter(({ friend, snap, streak }) => `${friend.username} ${friend.displayName ?? ""}`.toLowerCase().includes(friendSearch.toLowerCase().replace(/^@/, "")) && (listFilter !== "unread" || !!snap) && (listFilter !== "streaks" || !!streak?.currentStreak))
    .sort((first, second) => Number(!!second.snap) - Number(!!first.snap) || (second.snap?.createdAt ?? second.streak?.lastExchangeAt ?? "").localeCompare(first.snap?.createdAt ?? first.streak?.lastExchangeAt ?? "") || first.friend.username.localeCompare(second.friend.username));

  async function openFriendChat(username: string) {
    if (openingChat) return;
    setOpeningChat(username);
    setSnapError(null);
    try {
      const result = await apiFetch<{ conversationId: string }>("/conversations", { method: "POST", body: JSON.stringify({ username }) });
      navigate(`/dms?conversation=${result.conversationId}`);
    } catch { setSnapError("Could not open this chat. Try again."); }
    finally { setOpeningChat(null); }
  }

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
          <section aria-label="Snap filters" className="space-y-3">
            <input type="search" aria-label="Search Snap friends" placeholder="Search friends" value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} className="app-search snap-search w-full" />
            <div role="tablist" aria-label="Snap list" className="flex gap-1 border-b border-gray-200">
              {([ ["all", "All"], ["unread", "New Snaps"], ["streaks", "Streaks"] ] as const).map(([value, label]) => <button key={value} role="tab" type="button" aria-selected={listFilter === value} onClick={() => setListFilter(value)} className={`snap-tab min-h-11 flex-1 border-b-2 px-2 text-sm font-semibold ${listFilter === value ? "snap-tab-active" : "border-transparent text-gray-500"}`}>{label}{value === "unread" && snaps.length ? ` (${snaps.length})` : ""}</button>)}
            </div>
          </section>
          <section aria-label="Received Snaps" className="divide-y divide-gray-200">
            {snapError && <p role="alert" className="px-4 pt-3 text-sm text-red-600">{snapError}</p>}
            {(inboxLoading || followingLoading) && <p role="status" className="px-4 py-4 text-sm text-gray-500">Loading Snaps...</p>}
            {(inboxFailed || followingFailed) && <div role="alert" className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-red-600"><span>Could not load all Snap friends.</span><button type="button" onClick={() => { void retryInbox(); void retryFollowing(); }} className="min-h-11 shrink-0 px-2 font-semibold">Retry</button></div>}
            <div>
              {snapFriends.map(({ friend, snap, seen, streak }) => (
                <div key={friend.id} className="flex items-center gap-1 border-b border-gray-100 py-2">
                <button
                  onClick={() => snap ? void openSnap(snap) : void openFriendChat(friend.username)}
                  disabled={!!openingSnapId || !!openingChat}
                  aria-busy={!!snap && openingSnapId === snap.id}
                  className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-1 text-left"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white p-0.5">
                    <Avatar avatarKey={friend.avatarKey} username={friend.username} size={44} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm text-gray-900 ${snap ? "font-bold" : "font-medium"}`}>{friend.displayName || `@${friend.username}`}</span>
                    <span className={`mt-1 flex items-center gap-1.5 text-xs ${snap ? "font-semibold text-red-600" : "text-gray-500"}`}><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${snap ? "border-red-500 bg-red-500" : streak?.waitingForThem ? "rotate-45 border-sky-500" : "border-gray-400"}`} /><span className="truncate">{snap ? `New Snap · ${snaps.filter((item) => item.sender.id === friend.id).length}` : seen ? "Opened" : streak?.waitingForThem ? "Delivered" : "Tap to chat"}</span></span>
                    {snap?.isEncrypted && <span className="sr-only">End-to-end encrypted</span>}
                  </span>
                  <span className="flex w-14 shrink-0 flex-col items-end gap-1 whitespace-nowrap text-[11px] text-gray-500">
                    {(snap || seen) && <time dateTime={snap?.createdAt || seen?.viewedAt || seen?.createdAt}>{formatActivityTime(snap?.createdAt || seen?.viewedAt || seen!.createdAt)}</time>}
                    {!!streak?.currentStreak && <span aria-label={`${streak.currentStreak} day streak`} className="text-[10px]">🔥 {streak.currentStreak}</span>}
                  </span>
                  {snap && openingSnapId === snap.id ? (
                    <span aria-label="Opening" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
                  ) : (
                    <span className="sr-only">{snap ? "Unopened" : "Open chat"}</span>
                  )}
                </button>
                <button type="button" aria-label={`Chat with @${friend.username}`} title={`Chat with @${friend.username}`} disabled={!!openingChat} onClick={() => void openFriendChat(friend.username)} className="list-icon-action"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5A8.5 8.5 0 0 1 9.5 3h3A8.5 8.5 0 0 1 21 11.5Z" /></svg></button>
                <button type="button" aria-label={`Send a Snap to @${friend.username}`} title={`Send a Snap to @${friend.username}`} onClick={() => navigate(`/snaps?camera=1&snapTo=${encodeURIComponent(friend.username)}`)} className="list-icon-action"><CameraIcon /></button>
                </div>
              ))}
              {!snapFriends.length && !followingLoading && !inboxLoading && !inboxFailed && !followingFailed && (
                <p className="px-4 py-4 text-sm text-gray-500">{friendSearch ? "No matching friends." : listFilter === "unread" ? "No unopened Snaps." : listFilter === "streaks" ? "No active streaks yet." : "Follow friends to start a conversation."}</p>
              )}

            </div>
          </section>

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
