import { useEffect, useRef, useState } from "react";
import { getTimeZone } from "../../lib/theme.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateMusicMixCommentInput, MusicMix, MusicMixComment, MusicTrack } from "@app/shared";
import { apiFetch } from "../../lib/api.js";
import { mediaUrl, uploadMedia } from "../../lib/upload.js";
import { computePeaks } from "../../lib/voice.js";
import { formatDuration } from "../../lib/useAudioRecorder.js";
import { btnSecondary, input } from "../../lib/ui.js";
import Avatar from "../Avatar.js";

function formatMarker(timestampMs: number): string {
  const totalSeconds = Math.floor(timestampMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function parseTracklist(raw: string, durationMs: number): MusicTrack[] {
  return raw.split("\n").flatMap((line) => {
    const parts = line.split("|").map((value) => value.trim());
    if (parts.length < 2) return [];
    const timestamp = parts[0].match(/^(\d{1,3}):([0-5]\d)$/);
    if (!timestamp) return [];
    const startMs = (Number(timestamp[1]) * 60 + Number(timestamp[2])) * 1000;
    const title = parts.length > 2 ? parts.slice(2).join(" | ") : parts[1];
    const artist = parts.length > 2 ? parts[1] : "";
    if (startMs >= durationMs || !title) return [];
    return [{ title, artist, startMs }];
  }).slice(0, 80);
}

function MusicMixCard({ mix }: { mix: MusicMix }) {
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const { data: detail } = useQuery({
    queryKey: ["music-mix", mix.id],
    queryFn: () => apiFetch<{ mix: MusicMix; comments: MusicMixComment[] }>(`/music/mixes/${mix.id}`),
    enabled: expanded,
  });

  function seekTo(timestampMs: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = timestampMs / 1000;
    setCurrentMs(timestampMs);
    void audio.play().catch(() => undefined);
  }

  async function addTimestampComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = commentText.trim();
    if (!text || savingComment) return;
    setSavingComment(true);
    setCommentError(null);
    try {
      const body: CreateMusicMixCommentInput = { timestampMs: currentMs, text };
      await apiFetch(`/music/mixes/${mix.id}/comments`, { method: "POST", body: JSON.stringify(body) });
      setCommentText("");
      await queryClient.invalidateQueries({ queryKey: ["music-mix", mix.id] });
    } catch (caught) {
      setCommentError(caught instanceof Error ? caught.message : "Could not add this comment.");
    } finally {
      setSavingComment(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <Avatar avatarKey={mix.owner.avatarKey} username={mix.owner.username} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-gray-900">@{mix.owner.username} dropped a mix</p>
            <time className="text-[11px] text-gray-500">{new Date(mix.createdAt).toLocaleDateString(undefined, { timeZone: getTimeZone() })}</time>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800">SET</span>
        </div>
        <h3 className="mt-3 text-base font-semibold text-gray-900">{mix.title}</h3>
        {mix.description && <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-gray-600">{mix.description}</p>}
        <audio
          ref={audioRef}
          className="mt-3 w-full"
          controls
          preload="metadata"
          src={mediaUrl(mix.audioKey)}
          onTimeUpdate={(event) => setCurrentMs(Math.floor(event.currentTarget.currentTime * 1000))}
          onSeeked={(event) => setCurrentMs(Math.floor(event.currentTarget.currentTime * 1000))}
        />
        <div aria-label="Mix waveform" className="mt-2 flex h-10 items-center gap-[2px] overflow-hidden rounded-lg bg-gray-50 px-2">
          {mix.waveform.map((peak, index) => (
            <span key={index} style={{ height: `${Math.max(8, peak * 100)}%` }} className={`flex-1 rounded-full ${mix.durationMs > 0 && index / mix.waveform.length < currentMs / mix.durationMs ? "bg-emerald-700" : "bg-emerald-700/25"}`} />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-gray-500">
          <span>{formatDuration(currentMs)} / {formatDuration(mix.durationMs)}</span>
          <button type="button" onClick={() => setExpanded((value) => !value)} className="font-semibold text-emerald-800 hover:underline">
            {expanded ? "Hide tracklist & comments" : `${mix.tracklist.length} tracks · ${mix.commentCount} comments`}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-3">
          {mix.tracklist.length > 0 && (
            <div className="mb-3">
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tracklist</h4>
              <div className="divide-y divide-gray-100">
                {mix.tracklist.map((track, index) => (
                  <button key={`${track.startMs}-${index}`} type="button" onClick={() => seekTo(track.startMs)} className="flex w-full items-center gap-3 py-2 text-left hover:text-emerald-800">
                    <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-gray-500">{formatMarker(track.startMs)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800">{track.title}</span>
                    {track.artist && <span className="max-w-28 truncate text-[11px] text-gray-500">{track.artist}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Timestamp comments</h4>
            <span className="font-mono text-[10px] text-emerald-800">At {formatMarker(currentMs)}</span>
          </div>
          <form onSubmit={(event) => void addTimestampComment(event)} className="mt-2 flex gap-2">
            <input value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength={500} placeholder="Track ID?" className={`${input} min-w-0 flex-1 bg-white`} />
            <button type="submit" disabled={!commentText.trim() || savingComment} className={`${btnSecondary} shrink-0 px-3`}>{savingComment ? "…" : "Comment"}</button>
          </form>
          {commentError && <p role="alert" className="mt-1 text-xs text-red-600">{commentError}</p>}
          <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
            {(detail?.comments ?? []).map((comment) => (
              <button key={comment.id} type="button" onClick={() => seekTo(comment.timestampMs)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white">
                <span className="shrink-0 font-mono text-[10px] text-emerald-800">{formatMarker(comment.timestampMs)}</span>
                <span className="min-w-0 flex-1 text-xs text-gray-700"><b>@{comment.user.username}</b> {comment.text}</span>
              </button>
            ))}
            {detail && detail.comments.length === 0 && <p className="py-2 text-xs text-gray-500">No timestamp comments yet.</p>}
          </div>
        </div>
      )}
    </article>
  );
}

export function MusicMixFeed() {
  const { data: mixes = [] } = useQuery({
    queryKey: ["music-mix-feed"],
    queryFn: async () => (await apiFetch<{ mixes: MusicMix[] }>("/music/mixes/feed")).mixes,
  });
  if (!mixes.length) return null;
  return <section aria-label="Mixes and sets" className="mb-4 flex flex-col gap-3">{mixes.map((mix) => <MusicMixCard key={mix.id} mix={mix} />)}</section>;
}

export function MusicMixesProfile({ username, isOwnProfile }: { username: string; isOwnProfile: boolean }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tracklistText, setTracklistText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mixes, setMixes] = useState<MusicMix[]>([]);
  const { data } = useQuery({
    queryKey: ["music-mixes-user", username],
    queryFn: async () => (await apiFetch<{ mixes: MusicMix[] }>(`/music/mixes/user/${encodeURIComponent(username)}`)).mixes,
  });

  useEffect(() => { if (data) setMixes(data); }, [data]);

  async function uploadMix(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError("Choose an audio file.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("Mix audio must be 50 MB or smaller.");
      return;
    }
    if (!title.trim()) {
      setError("Add a mix title before uploading.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const [durationMs, waveform] = await Promise.all([
        readDuration(file),
        computePeaks(file),
      ]);
      if (durationMs < 30_000 || durationMs > 3 * 60 * 60 * 1000) throw new Error("Mixes must be between 30 seconds and 3 hours.");
      if (waveform.length < 16) throw new Error("Could not analyze this audio file. Try MP3, WAV, or M4A.");
      const audioKey = await uploadMedia(file, { resize: false });
      const response = await apiFetch<{ mix: MusicMix }>("/music/mixes", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          audioKey,
          durationMs,
          waveform,
          tracklist: parseTracklist(tracklistText, durationMs),
        }),
      });
      setMixes((current) => [response.mix, ...current]);
      setTitle("");
      setDescription("");
      setTracklistText("");
      await queryClient.invalidateQueries({ queryKey: ["music-mix-feed"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload this mix.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section aria-label="Mixes and sets" className="mb-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-gray-900">Mixes & sets</h2><p className="mt-0.5 text-xs text-gray-500">Full-length sets with track markers</p></div>
        {isOwnProfile && <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-full bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{uploading ? "Analyzing…" : "Drop a set"}</button>}
      </div>
      {isOwnProfile && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Mix title" className={input} />
            <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Short description" className={input} />
          </div>
          <textarea value={tracklistText} onChange={(event) => setTracklistText(event.target.value)} rows={2} placeholder="Tracklist markers: 00:00 | Artist | Track title" className={`${input} mt-2 w-full`} />
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(event) => void uploadMix(event)} />
          {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
      {mixes.map((mix) => <MusicMixCard key={mix.id} mix={mix} />)}
      {!mixes.length && <p className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">No mixes shared yet.</p>}
    </section>
  );
}

function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read mix duration."));
    };
    audio.src = url;
  });
}
