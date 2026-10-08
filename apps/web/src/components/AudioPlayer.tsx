import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../lib/useAudioRecorder.js";

const SPEEDS = [1, 1.5, 2] as const;

// Plays a (possibly still loading) audio source with a waveform and playback speed.
export default function AudioPlayer({
  src,
  durationMs,
  peaks,
  tone = "light",
  autoPlay = false,
  loading = false,
  error = null,
  onRequestLoad,
}: {
  src: string | null;
  durationMs: number;
  peaks: number[];
  tone?: "light" | "dark";
  autoPlay?: boolean;
  loading?: boolean;
  error?: string | null;
  // Called when the user taps play before the audio has been fetched.
  onRequestLoad?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
  }, [src]);

  useEffect(() => {
    if (autoPlay && src && audioRef.current) {
      void audioRef.current.play().catch(() => undefined);
    }
  }, [autoPlay, src]);

  const bars = peaks.length > 0 ? peaks : Array.from({ length: 32 }, (_, index) => 0.35 + ((index * 7) % 5) / 12);
  const accent = tone === "dark" ? "bg-white" : "bg-black";
  const muted = tone === "dark" ? "bg-white/35" : "bg-black/20";
  const text = tone === "dark" ? "text-white/80" : "text-gray-600";

  function toggle() {
    const audio = audioRef.current;
    if (!audio) {
      if (!loading) onRequestLoad?.();
      return;
    }
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;
  }

  function seekByKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") audio.currentTime = Math.max(0, audio.currentTime - 5);
    else if (event.key === "Home") audio.currentTime = 0;
    else if (event.key === "End") audio.currentTime = audio.duration;
    else return;
    event.preventDefault();
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  const shownMs = playing || progress > 0 ? durationMs * (1 - progress) : durationMs;

  return (
    <div className="flex w-56 max-w-full items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={!src && !onRequestLoad}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-50 ${tone === "dark" ? "bg-white text-black" : "bg-black text-white"}`}
      >
        {loading ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className="flex h-7 cursor-pointer items-center gap-[2px] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={seek}
          onKeyDown={seekByKeyboard}
          role="slider"
          tabIndex={src ? 0 : -1}
          aria-label="Audio position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuetext={`${formatDuration(durationMs * progress)} of ${formatDuration(durationMs)}`}
        >
          {bars.map((peak, index) => (
            <span
              key={index}
              style={{ height: `${Math.max(12, peak * 100)}%` }}
              className={`w-[3px] flex-1 rounded-full ${index / bars.length < progress ? accent : muted}`}
            />
          ))}
        </div>
        <div className={`mt-0.5 flex items-center justify-between text-[10px] ${text}`}>
          <span>{error ?? formatDuration(shownMs)}</span>
          <button
            type="button"
            onClick={cycleSpeed}
            aria-label="Change playback speed"
            className="rounded px-1 font-semibold tabular-nums hover:opacity-80"
          >
            {SPEEDS[speedIndex]}x
          </button>
        </div>
      </div>
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(event) => {
            const audio = event.currentTarget;
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
              setProgress(audio.currentTime / audio.duration);
            }
          }}
        />
      )}
    </div>
  );
}
