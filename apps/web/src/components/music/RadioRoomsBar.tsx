import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LIVE_ROOM_AUDIENCES } from "@app/shared";
import type { LiveRoomAudience, MusicMix, RadioMessage, RadioRoom } from "@app/shared";
import { apiFetch } from "../../lib/api.js";
import { mediaUrl } from "../../lib/upload.js";
import { useAuth } from "../../auth/AuthContext.js";
import { getSocket } from "../../lib/socket.js";
import { input } from "../../lib/ui.js";
import Avatar from "../Avatar.js";

async function fetchRadioRooms(): Promise<RadioRoom[]> {
  return new Promise((resolve) => {
    const socket = getSocket();
    const timeout = window.setTimeout(() => resolve([]), 8_000);
    socket.emit("radio:rooms:list", (rooms: RadioRoom[]) => {
      window.clearTimeout(timeout);
      resolve(Array.isArray(rooms) ? rooms : []);
    });
  });
}

function emitWithAck<T>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Radio request timed out.")), 8_000);
    getSocket().emit(event, payload, (result: T) => {
      window.clearTimeout(timeout);
      resolve(result);
    });
  });
}

function formatClock(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function RadioRoomsBar({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const applyPlaybackRef = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [mixes, setMixes] = useState<MusicMix[]>([]);
  const [selectedMixId, setSelectedMixId] = useState("");
  const [audience, setAudience] = useState<LiveRoomAudience>("friends");
  const [roomTitle, setRoomTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRadio, setActiveRadio] = useState<RadioRoom | null>(null);
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState<RadioMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [needsPlayTap, setNeedsPlayTap] = useState(false);

  const { data: radios = [], isError: roomsError } = useQuery({
    queryKey: ["radio-rooms"],
    queryFn: fetchRadioRooms,
    enabled: !!user,
    refetchInterval: 15_000,
  });
  const { data: ownMixes = [] } = useQuery({
    queryKey: ["music-mixes-user", user?.username],
    queryFn: async () => (await apiFetch<{ mixes: MusicMix[] }>(`/music/mixes/user/${encodeURIComponent(user!.username)}`)).mixes,
    enabled: !!user && !compact,
  });

  useEffect(() => {
    if (!ownMixes.length) return;
    setMixes(ownMixes);
    setSelectedMixId((current) => current || ownMixes[0].id);
  }, [ownMixes]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["radio-rooms"] });
    function onPlayback(payload: { radioId: string; positionMs: number; isPlaying: boolean; syncedAt: string }) {
      setActiveRadio((current) => current?.radioId === payload.radioId
        ? { ...current, positionMs: payload.positionMs, isPlaying: payload.isPlaying, syncedAt: payload.syncedAt }
        : current);
      setIsPlaying(payload.isPlaying);
      setPositionMs(payload.positionMs);
      const audio = audioRef.current;
      if (!audio || activeRadio?.hostUserId === user?.id) return;
      const serverSync = Date.parse(payload.syncedAt);
      const position = Math.min(activeRadio?.mix.durationMs ?? Number.MAX_SAFE_INTEGER,
        payload.positionMs + (payload.isPlaying && Number.isFinite(serverSync) ? Math.max(0, Date.now() - serverSync) : 0));
      applyPlaybackRef.current = true;
      audio.currentTime = position / 1000;
      if (payload.isPlaying) {
        void audio.play().then(() => setNeedsPlayTap(false)).catch(() => setNeedsPlayTap(true));
      } else {
        audio.pause();
      }
      window.setTimeout(() => { applyPlaybackRef.current = false; }, 0);
    }
    function onRadioMessage(message: RadioMessage) {
      if (message.radioId === activeRadio?.radioId) setMessages((current) => [...current.slice(-99), message]);
    }
    function onParticipants(payload: { radioId: string; participantIds: string[] }) {
      setActiveRadio((current) => current?.radioId === payload.radioId ? { ...current, participantIds: payload.participantIds } : current);
    }
    function onEnded(payload: { radioId: string }) {
      if (payload.radioId !== activeRadio?.radioId) return;
      setActiveRadio(null);
      setJoined(false);
      setMessages([]);
      setIsPlaying(false);
      setNeedsPlayTap(false);
      void queryClient.invalidateQueries({ queryKey: ["radio-rooms"] });
    }
    socket.on("radio:rooms:changed", refresh);
    socket.on("radio:playback", onPlayback);
    socket.on("radio:message", onRadioMessage);
    socket.on("radio:participants", onParticipants);
    socket.on("radio:ended", onEnded);
    return () => {
      socket.off("radio:rooms:changed", refresh);
      socket.off("radio:playback", onPlayback);
      socket.off("radio:message", onRadioMessage);
      socket.off("radio:participants", onParticipants);
      socket.off("radio:ended", onEnded);
    };
  }, [activeRadio?.hostUserId, activeRadio?.mix.durationMs, activeRadio?.radioId, queryClient, user?.id]);

  useEffect(() => {
    if (!activeRadio || !joined || activeRadio.hostUserId !== user?.id) return;
    const interval = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      getSocket().emit("radio:playback", {
        radioId: activeRadio.radioId,
        positionMs: Math.floor(audio.currentTime * 1000),
        isPlaying: !audio.paused,
      });
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [activeRadio, joined, user?.id]);

  async function startRadio() {
    const mix = mixes.find((candidate) => candidate.id === selectedMixId);
    if (!mix || !user || starting) return;
    setStarting(true);
    setError(null);
    try {
      const conversation = await apiFetch<{ conversationId: string }>("/conversations/group", {
        method: "POST",
        body: JSON.stringify({ name: `Radio: ${roomTitle.trim() || mix.title}`, usernames: [], allowEmpty: true }),
      });
      const radioId = crypto.randomUUID();
      const result = await emitWithAck<{ ok: boolean; error?: string }>("radio:start", {
        radioId,
        conversationId: conversation.conversationId,
        mixId: mix.id,
        audience,
        title: roomTitle.trim() || mix.title,
      });
      if (!result.ok) throw new Error(result.error ?? "Could not start radio.");
      setActiveRadio({
        radioId,
        mixId: mix.id,
        mix,
        title: roomTitle.trim() || mix.title,
        hostUserId: user.id,
        audience,
        participantIds: [user.id],
        members: [user],
        isPlaying: false,
        positionMs: 0,
        syncedAt: new Date().toISOString(),
      });
      setMessages([]);
      setJoined(true);
      setIsPlaying(false);
      setPositionMs(0);
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["radio-rooms"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start radio.");
    } finally {
      setStarting(false);
    }
  }

  async function joinRadio(room: RadioRoom) {
    try {
      const result = await emitWithAck<{
        ok: boolean; error?: string; positionMs?: number; isPlaying?: boolean;
        syncedAt?: string; participantIds?: string[]; messages?: RadioMessage[];
      }>("radio:join", { radioId: room.radioId });
      if (!result.ok) throw new Error(result.error ?? "Could not join radio.");
      const syncedAt = result.syncedAt ?? new Date().toISOString();
      setActiveRadio({ ...room, positionMs: result.positionMs ?? room.positionMs, isPlaying: result.isPlaying ?? room.isPlaying, syncedAt, participantIds: result.participantIds ?? room.participantIds });
      setMessages(result.messages ?? []);
      setPositionMs(result.positionMs ?? room.positionMs);
      setIsPlaying(result.isPlaying ?? room.isPlaying);
      setJoined(true);
      setNeedsPlayTap(result.isPlaying ?? room.isPlaying);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join radio.");
    }
  }

  function leaveRadio() {
    if (activeRadio && joined) getSocket().emit("radio:leave", { radioId: activeRadio.radioId });
    audioRef.current?.pause();
    setActiveRadio(null);
    setJoined(false);
    setMessages([]);
    setNeedsPlayTap(false);
    void queryClient.invalidateQueries({ queryKey: ["radio-rooms"] });
  }

  function sendRadioMessage(kind: "text" | "emoji", content: string) {
    if (!activeRadio || !joined || !content.trim()) return;
    getSocket().emit("radio:message", { radioId: activeRadio.radioId, kind, content: content.trim() });
    if (kind === "text") setMessageText("");
  }

  function syncHostPlayback(audio: HTMLAudioElement) {
    if (!activeRadio || activeRadio.hostUserId !== user?.id || applyPlaybackRef.current) return;
    const nextPosition = Math.floor(audio.currentTime * 1000);
    setPositionMs(nextPosition);
    setIsPlaying(!audio.paused);
    getSocket().emit("radio:playback", { radioId: activeRadio.radioId, positionMs: nextPosition, isPlaying: !audio.paused });
  }

  async function requestListenerPlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    const serverTime = Date.parse(activeRadio?.syncedAt ?? "");
    const nextPosition = Math.min(activeRadio?.mix.durationMs ?? 0,
      positionMs + (isPlaying && Number.isFinite(serverTime) ? Math.max(0, Date.now() - serverTime) : 0));
    audio.currentTime = nextPosition / 1000;
    try {
      if (isPlaying) await audio.play();
      else setNeedsPlayTap(false);
      setNeedsPlayTap(false);
    } catch {
      setNeedsPlayTap(true);
    }
  }

  const visibleRooms = radios.filter((room) => !room.participantIds.includes(user?.id ?? ""));

  return (
    <>
      {compact ? (
        <>
          {visibleRooms.map((room) => (
            <button key={room.radioId} type="button" onClick={() => void joinRadio(room)} disabled={!!activeRadio} aria-label={`Join radio: ${room.title}`} title={room.title} className="flex shrink-0 flex-col items-center gap-1">
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-emerald-400 bg-emerald-50 text-emerald-800">
                <span aria-hidden="true" className="text-xl">♫</span>
                <span className="absolute -bottom-1 rounded-full bg-emerald-700 px-1.5 text-[9px] font-bold uppercase leading-4 text-white ring-2 ring-white">Radio</span>
              </span>
              <span className="max-w-[62px] truncate text-[11px] font-semibold text-emerald-800">@{room.mix.owner.username}</span>
            </button>
          ))}
          {activeRadio && renderRadioStage()}
        </>
      ) : (
        <details className="mt-3 border-t border-gray-100 pt-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 [&::-webkit-details-marker]:hidden">
            <span><span className="block text-sm font-semibold text-gray-900">Radio</span><span className="mt-0.5 block text-[11px] text-gray-500">Listen together, audio only</span></span>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800">{radios.length} live</span>
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {roomsError && <p className="text-xs text-gray-500">Could not load radio rooms.</p>}
            {visibleRooms.map((room) => (
              <div key={room.radioId} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
                <Avatar avatarKey={room.mix.owner.avatarKey} username={room.mix.owner.username} size={40} />
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-gray-900">{room.title}</span><span className="block text-[11px] text-gray-500">Hosted by @{room.mix.owner.username} · {room.participantIds.length} listening</span></span>
                <button type="button" onClick={() => void joinRadio(room)} disabled={!!activeRadio} className="rounded-full bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Join</button>
              </div>
            ))}
            {user && <div className="flex flex-wrap items-end gap-2 rounded-xl bg-gray-50 p-3">
              <label className="min-w-0 flex-1 text-[11px] font-medium text-gray-700">Your mix
                <select value={selectedMixId} onChange={(event) => setSelectedMixId(event.target.value)} onFocus={() => setCreateOpen(true)} className={`${input} mt-1 w-full`}>
                  {mixes.map((mix) => <option key={mix.id} value={mix.id}>{mix.title}</option>)}
                  {mixes.length === 0 && <option value="">No uploaded mixes yet</option>}
                </select>
              </label>
              <label className="min-w-0 flex-1 text-[11px] font-medium text-gray-700">Who can join?
                <select value={audience} onChange={(event) => setAudience(event.target.value as LiveRoomAudience)} className={`${input} mt-1 w-full`}>
                  {LIVE_ROOM_AUDIENCES.filter((option) => option !== "invited").map((option) => <option key={option} value={option}>{option === "close_friends" ? "Close friends" : option === "friends" ? "Friends" : "Everyone"}</option>)}
                </select>
              </label>
              <label className="min-w-0 flex-1 text-[11px] font-medium text-gray-700">Session title
                <input value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} maxLength={80} placeholder="Listening together" className={`${input} mt-1 w-full`} />
              </label>
              <button type="button" onClick={() => void startRadio()} disabled={starting || !mixes.length} className="rounded-full bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{starting ? "Starting…" : "Start radio"}</button>
              {error && <p role="alert" className="w-full text-xs text-red-600">{error}</p>}
              {mixes.length === 0 && <p className="w-full text-[11px] text-gray-500">Upload a mix on your profile before starting a radio.</p>}
            </div>}
          </div>
          {activeRadio && renderRadioStage()}
        </details>
      )}
    </>
  );

  function renderRadioStage() {
    if (!activeRadio || !joined) return null;
    const host = activeRadio.hostUserId === user?.id;
    return (
      <div className="fixed inset-0 z-[70] flex flex-col bg-gray-950 text-white" role="dialog" aria-modal="true" aria-label="Radio room">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-lg text-emerald-300">♫</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{activeRadio.title}</span><span className="block text-[11px] text-white/60">{host ? "You're hosting · audio only" : `@${activeRadio.mix.owner.username} is hosting · audio only`}</span></span>
          <span className="text-[11px] tabular-nums text-white/70">{activeRadio.participantIds.length} listening</span>
          <button type="button" onClick={leaveRadio} aria-label="Leave radio" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/15">×</button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
          <div className="mx-auto w-full max-w-xl">
            <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center gap-3"><Avatar avatarKey={activeRadio.mix.owner.avatarKey} username={activeRadio.mix.owner.username} size={44} /><span><span className="block text-xs font-semibold">{activeRadio.mix.title}</span><span className="mt-0.5 block text-[11px] text-white/55">{activeRadio.mix.owner.username} · {activeRadio.mix.tracklist.length} tracks</span></span></div>
              <audio
                ref={audioRef}
                src={mediaUrl(activeRadio.mix.audioKey)}
                preload="auto"
                controls={host}
                controlsList={host ? undefined : "nodownload noplaybackrate"}
                className={host ? "w-full" : "sr-only"}
                onLoadedMetadata={(event) => {
                  if (!host) {
                    event.currentTarget.currentTime = positionMs / 1000;
                    if (isPlaying) void event.currentTarget.play().catch(() => setNeedsPlayTap(true));
                  }
                }}
                onTimeUpdate={(event) => {
                  const next = Math.floor(event.currentTarget.currentTime * 1000);
                  setPositionMs(next);
                }}
                onPlay={(event) => { if (host) syncHostPlayback(event.currentTarget); }}
                onPause={(event) => { if (host) syncHostPlayback(event.currentTarget); }}
                onSeeked={(event) => { if (host) syncHostPlayback(event.currentTarget); }}
                onEnded={() => { if (host && activeRadio) getSocket().emit("radio:playback", { radioId: activeRadio.radioId, positionMs: 0, isPlaying: false }); }}
              />
              {!host && <button type="button" onClick={() => void requestListenerPlayback()} className="mt-2 w-full rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-gray-950">{needsPlayTap ? "Tap to sync and listen" : isPlaying ? "Listening in sync" : "Tap to listen"}</button>}
              <p className="mt-2 text-[10px] text-white/45">Only the host controls playback. Reactions and chat are open to everyone.</p>
            </div>
            <div className="space-y-2">
              {messages.map((message) => <p key={message.id} className="text-sm leading-5"><span className="mr-2 font-semibold text-emerald-300">@{message.user.username}</span>{message.content}<span className="ml-2 text-[10px] text-white/40">{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></p>)}
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 bg-gray-950 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex w-full max-w-xl items-center gap-2">
            {[
              "👏", "🔥", "💚", "✨", "😍",
            ].map((emoji) => <button key={emoji} type="button" onClick={() => sendRadioMessage("emoji", emoji)} aria-label={`React ${emoji}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-base hover:bg-white/15">{emoji}</button>)}
            <form onSubmit={(event) => { event.preventDefault(); sendRadioMessage("text", messageText); }} className="flex min-w-0 flex-1 gap-2">
              <input value={messageText} onChange={(event) => setMessageText(event.target.value)} maxLength={400} placeholder="Say something…" className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/45 focus:border-emerald-400 focus:outline-none" />
              <button type="submit" disabled={!messageText.trim()} aria-label="Send radio message" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-gray-950 disabled:opacity-40">➤</button>
            </form>
          </div>
        </div>
      </div>
    );
  }
}
