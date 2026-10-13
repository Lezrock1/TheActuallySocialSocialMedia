import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MusicNowPlaying, MusicTaste, MusicTasteMatch, MusicProvider } from "@app/shared";
import { apiFetch } from "../../lib/api.js";
import { formatActivityTime, input } from "../../lib/ui.js";
import Avatar from "../Avatar.js";

const PROVIDERS: Array<{ value: MusicProvider; label: string }> = [
  { value: "spotify", label: "Spotify" },
  { value: "apple_music", label: "Apple Music" },
  { value: "soundcloud", label: "SoundCloud" },
];

async function fetchNowPlaying(username: string): Promise<MusicNowPlaying | null> {
  return (await apiFetch<{ status: MusicNowPlaying | null }>(`/music/now-playing/${encodeURIComponent(username)}`)).status;
}

async function fetchTaste(username: string): Promise<MusicTaste> {
  return (await apiFetch<{ taste: MusicTaste }>(`/music/taste/${encodeURIComponent(username)}`)).taste;
}

async function fetchTasteMatch(username: string): Promise<MusicTasteMatch> {
  return (await apiFetch<{ match: MusicTasteMatch }>(`/music/taste-match/${encodeURIComponent(username)}`)).match;
}

function csvValues(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function NowPlayingProfile({ username, isOwnProfile, canViewStatus = true }: { username: string; isOwnProfile: boolean; canViewStatus?: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<MusicProvider>("spotify");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: status = null } = useQuery({
    queryKey: ["music-now-playing", username],
    queryFn: () => fetchNowPlaying(username),
    enabled: isOwnProfile || canViewStatus,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!status || editing) return;
    setProvider(status.provider);
    setTitle(status.title);
    setArtist(status.artist);
    setUrl(status.url);
  }, [editing, status]);

  async function saveStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/music/now-playing", {
        method: "POST",
        body: JSON.stringify({ provider, title, artist, url }),
      });
      await queryClient.invalidateQueries({ queryKey: ["music-now-playing", username] });
      await queryClient.invalidateQueries({ queryKey: ["music-now-playing-feed"] });
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your music status.");
    } finally {
      setSaving(false);
    }
  }

  async function clearStatus() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/music/now-playing", { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["music-now-playing", username] });
      await queryClient.invalidateQueries({ queryKey: ["music-now-playing-feed"] });
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear your music status.");
    } finally {
      setSaving(false);
    }
  }

  if (!status && !isOwnProfile) return null;

  return (
    <section aria-label="Now playing" className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Now playing</h2>
          {status && !editing && <p className="mt-0.5 text-[11px] text-gray-500">Updated {formatActivityTime(status.updatedAt)}</p>}
        </div>
        {isOwnProfile && (
          <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50">
            {editing ? "Cancel" : status ? "Edit" : "Share"}
          </button>
        )}
      </div>

      {editing && isOwnProfile ? (
        <form onSubmit={(event) => void saveStatus(event)} className="mt-3 flex flex-col gap-2.5">
          <select aria-label="Music service" value={provider} onChange={(event) => setProvider(event.target.value as MusicProvider)} className={input}>
            {PROVIDERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Track title" className={input} />
            <input required maxLength={120} value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Artist" className={input} />
          </div>
          <input required type="url" maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://… track link" className={input} />
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {status && <button type="button" onClick={() => void clearStatus()} disabled={saving} className="rounded-full border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">Clear status</button>}
            <button type="submit" disabled={saving} className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50">{saving ? "Saving…" : "Share track"}</button>
          </div>
        </form>
      ) : status ? (
        <a href={status.url} target="_blank" rel="noreferrer" className="mt-3 flex min-w-0 items-center gap-3 rounded-lg bg-emerald-50/70 p-3 transition-colors hover:bg-emerald-50">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm text-white">♫</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-gray-900">{status.title}</span>
            <span className="block truncate text-xs text-gray-600">{status.artist} · {PROVIDERS.find((option) => option.value === status.provider)?.label}</span>
          </span>
          <span aria-hidden="true" className="text-xs text-emerald-800">↗</span>
        </a>
      ) : (
        <p className="mt-2 text-xs text-gray-500">Share the track you have on repeat.</p>
      )}
    </section>
  );
}

export function NowPlayingFeed() {
  const { data: statuses = [] } = useQuery({
    queryKey: ["music-now-playing-feed"],
    queryFn: async () => (await apiFetch<{ statuses: MusicNowPlaying[] }>("/music/now-playing/feed")).statuses,
    refetchInterval: 60_000,
  });
  if (statuses.length === 0) return null;
  return (
    <section aria-label="Friends are listening to" className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">On repeat</h2>
        <span className="text-[11px] text-gray-400">Friends listening now</span>
      </div>
      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        {statuses.map((status) => (
          <a key={status.id} href={status.url} target="_blank" rel="noreferrer" className="flex w-64 shrink-0 snap-start items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-3 shadow-[0_2px_12px_rgba(15,23,42,0.05)] transition-colors hover:border-emerald-200 hover:bg-emerald-50/30">
            <Avatar avatarKey={status.user.avatarKey} username={status.user.username} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] text-gray-500">@{status.user.username} is listening to</span>
              <span className="mt-0.5 block truncate text-xs font-semibold text-gray-900">{status.title}</span>
              <span className="block truncate text-[11px] text-gray-500">{status.artist}</span>
            </span>
            <span aria-hidden="true" className="text-sm text-emerald-700">♫</span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function MusicTastePanel({ username, isOwnProfile }: { username: string; isOwnProfile: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [genresText, setGenresText] = useState("");
  const [tracksText, setTracksText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: taste } = useQuery({
    queryKey: ["music-taste", username],
    queryFn: () => fetchTaste(username),
    enabled: isOwnProfile,
  });
  const { data: match } = useQuery({
    queryKey: ["music-taste-match", username],
    queryFn: () => fetchTasteMatch(username),
    enabled: !isOwnProfile,
  });

  useEffect(() => {
    if (!taste || editing) return;
    setGenresText(taste.genres.join(", "));
    setTracksText(taste.favoriteTracks.join(", "));
  }, [editing, taste]);

  async function saveTaste(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/music/taste", {
        method: "PATCH",
        body: JSON.stringify({ genres: csvValues(genresText).slice(0, 20), favoriteTracks: csvValues(tracksText).slice(0, 20) }),
      });
      await queryClient.invalidateQueries({ queryKey: ["music-taste", username] });
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your music taste.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Music taste" className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Music taste</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">Genres and tracks you love</p>
        </div>
        {isOwnProfile && <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">{editing ? "Cancel" : "Edit"}</button>}
      </div>
      {editing && isOwnProfile ? (
        <form onSubmit={(event) => void saveTaste(event)} className="mt-3 flex flex-col gap-2">
          <label className="text-xs font-medium text-gray-700">Genres<input value={genresText} onChange={(event) => setGenresText(event.target.value)} placeholder="House, Jazz, Ambient" className={`${input} mt-1 w-full`} /></label>
          <label className="text-xs font-medium text-gray-700">Favorite tracks<input value={tracksText} onChange={(event) => setTracksText(event.target.value)} placeholder="Artist — Track, …" className={`${input} mt-1 w-full`} /></label>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="self-end rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{saving ? "Saving…" : "Save taste"}</button>
        </form>
      ) : isOwnProfile ? (
        <div className="mt-3 space-y-2 text-xs">
          <p className="text-gray-600"><span className="font-semibold text-gray-800">Genres</span> · {taste?.genres.join(" · ") || "Add a few favourites"}</p>
          <p className="text-gray-600"><span className="font-semibold text-gray-800">Tracks</span> · {taste?.favoriteTracks.join(" · ") || "Share tracks you love"}</p>
        </div>
      ) : match ? (
        <div className="mt-3">
          <div className="flex items-baseline gap-2"><span className="text-2xl font-bold tabular-nums text-emerald-800">{match.score}%</span><span className="text-xs text-gray-500">taste match</span></div>
          <p className="mt-2 text-xs leading-5 text-gray-600">Shared genres: {match.sharedGenres.join(" · ") || "Not yet"}</p>
          <p className="mt-1 text-xs leading-5 text-gray-600">Shared tracks: {match.sharedTracks.join(" · ") || "Not yet"}</p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-500">Taste Match is available between friends who have shared their music taste.</p>
      )}
    </section>
  );
}
