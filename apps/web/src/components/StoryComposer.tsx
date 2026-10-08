import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MAX_STORY_AUDIO_MS } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { uploadMedia } from "../lib/upload.js";
import { audienceBody, PUBLIC_AUDIENCE } from "../lib/circles.js";
import type { Audience } from "../lib/circles.js";
import { computePeaks, normalizeAudioType } from "../lib/voice.js";
import { formatDuration, isAudioRecordingSupported, useAudioRecorder } from "../lib/useAudioRecorder.js";
import type { AudioRecording } from "../lib/useAudioRecorder.js";
import { btnPrimary, btnSecondary, input } from "../lib/ui.js";
import Sheet from "./Sheet.js";
import AudiencePicker from "./AudiencePicker.js";
import AudioPlayer from "./AudioPlayer.js";
import { MeetupFields, defaultMeetupDraft, validateMeetupDraft } from "./MeetupFields.js";
import type { MeetupDraft } from "./MeetupFields.js";

const GRADIENTS: [string, string][] = [
  ["#6366f1", "#ec4899"],
  ["#0ea5e9", "#22c55e"],
  ["#f97316", "#e11d48"],
  ["#8b5cf6", "#06b6d4"],
];

// Audio-only stories still need a cover image for the story bubble and previews.
async function renderAudioCover(peaks: number[], seed: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the story cover.");
  const [from, to] = GRADIENTS[seed % GRADIENTS.length];
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const bars = peaks.length > 0 ? peaks : Array.from({ length: 40 }, (_, index) => 0.3 + ((index * 7) % 5) / 8);
  const barWidth = 10;
  const gap = 6;
  const total = bars.length * (barWidth + gap) - gap;
  let x = (canvas.width - total) / 2;
  context.fillStyle = "rgba(255,255,255,0.92)";
  for (const peak of bars) {
    const height = Math.max(24, peak * 360);
    context.beginPath();
    context.roundRect(x, canvas.height / 2 - height / 2, barWidth, height, 5);
    context.fill();
    x += barWidth + gap;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Could not prepare the story cover.");
  return new File([blob], "voice-story.jpg", { type: "image/jpeg" });
}

export default function StoryComposer({
  open,
  onClose,
  initialImage,
}: {
  open: boolean;
  onClose: () => void;
  initialImage?: File | null;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [audio, setAudio] = useState<AudioRecording | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<Audience>(PUBLIC_AUDIENCE);
  const [withMeetup, setWithMeetup] = useState(false);
  const [meetup, setMeetup] = useState<MeetupDraft>(defaultMeetupDraft);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useAudioRecorder({
    maxMs: MAX_STORY_AUDIO_MS,
    onFinished: (recording) => {
      if (recording.durationMs < 700) return;
      setAudio(recording);
      void computePeaks(recording.blob).then(setPeaks);
    },
  });

  useEffect(() => {
    if (open && initialImage) setImage(initialImage);
  }, [initialImage, open]);

  useEffect(() => {
    if (!image) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    if (!audio) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audio.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  function reset() {
    recorder.cancel();
    setImage(null);
    setAudio(null);
    setPeaks([]);
    setCaption("");
    setAudience(PUBLIC_AUDIENCE);
    setWithMeetup(false);
    setMeetup(defaultMeetupDraft());
    setError(null);
  }

  function close() {
    if (posting) return;
    reset();
    onClose();
  }

  async function post() {
    if (!image && !audio) return;
    if (withMeetup) {
      const problem = validateMeetupDraft(meetup);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setPosting(true);
    setError(null);
    try {
      const cover = image ?? await renderAudioCover(peaks, Math.floor(Math.random() * GRADIENTS.length));
      const imageKey = await uploadMedia(cover);
      let audioKey: string | undefined;
      if (audio) {
        const file = new File([audio.blob], "story-audio", { type: normalizeAudioType(audio.blob.type) });
        audioKey = await uploadMedia(file, { resize: false });
      }
      await apiFetch("/stories", {
        method: "POST",
        body: JSON.stringify({
          imageKey,
          ...(audioKey && audio ? { audioKey, audioDurationMs: Math.min(MAX_STORY_AUDIO_MS, Math.round(audio.durationMs)) } : {}),
          ...(caption.trim() ? { text: caption.trim() } : {}),
          ...audienceBody(audience),
          ...(withMeetup
            ? {
                meetup: {
                  ...(meetup.title.trim() ? { title: meetup.title.trim() } : {}),
                  startsAt: new Date(meetup.when).toISOString(),
                  place: meetup.place.trim(),
                },
              }
            : {}),
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["stories"] });
      reset();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? `${caught.message} \u00b7 Story not sent.` : "Story upload failed.");
    } finally {
      setPosting(false);
    }
  }

  const hasMedia = !!image || !!audio;

  return (
    <Sheet
      open={open}
      onClose={close}
      title="New story"
      tall
      footer={hasMedia ? (
        <>
          {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
          <button type="button" onClick={() => void post()} disabled={posting || recorder.recording} className={`${btnPrimary} w-full`}>
            {posting ? "Sharing…" : "Share story"}
          </button>
        </>
      ) : undefined}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) setImage(file);
        }}
      />

      {!hasMedia && !recorder.recording && (
        <div className="grid grid-cols-2 gap-3 py-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-gradient-to-br from-fuchsia-50 to-white px-4 py-7 text-sm font-semibold text-gray-800 transition-transform hover:border-gray-300 active:scale-[0.98]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-fuchsia-600" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="18" height="14" rx="3" />
              <circle cx="12" cy="13" r="3.5" />
              <path d="m8 6 1.5-2.5h5L16 6" />
            </svg>
            Photo
          </button>
          <button
            type="button"
            onClick={() => void recorder.start()}
            disabled={!isAudioRecordingSupported()}
            className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-gradient-to-br from-indigo-50 to-white px-4 py-7 text-sm font-semibold text-gray-800 transition-transform hover:border-gray-300 active:scale-[0.98] disabled:opacity-50"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-indigo-600" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            Voice
          </button>
          <p className="col-span-2 text-center text-xs leading-5 text-gray-500">
            Stories disappear after 24 hours. Voice stories can be up to {MAX_STORY_AUDIO_MS / 1000} seconds.
          </p>
          <p className="col-span-2 text-center text-[11px] leading-4 text-gray-400">
            {isAudioRecordingSupported()
              ? "Microphone is used only while recording. Audio stories follow your audience settings but are not end-to-end encrypted; chat voice messages are."
              : "This browser cannot record audio. Choose a photo instead. Audio stories are not end-to-end encrypted."}
          </p>
        </div>
      )}

      {recorder.recording && (
        <div className="flex flex-col items-center gap-4 py-6">
          <span className="record-pulse flex h-20 w-20 items-center justify-center rounded-full bg-red-500 text-white">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-9 w-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </span>
          <p className="text-2xl font-semibold tabular-nums text-gray-900">{formatDuration(recorder.elapsedMs)}</p>
          <div className="flex h-8 w-48 items-center gap-[3px]" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => (
              <span
                key={index}
                style={{ height: `${Math.max(12, Math.min(100, recorder.level * 100 * (0.45 + ((index * 5) % 7) / 8)))}%` }}
                className="w-1 flex-1 rounded-full bg-red-400 transition-[height] duration-100"
              />
            ))}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={recorder.cancel} className={btnSecondary}>Discard</button>
            <button type="button" onClick={recorder.stop} className={btnPrimary}>Done</button>
          </div>
        </div>
      )}

      {hasMedia && (
        <div className="flex flex-col gap-4">
          <div className="relative mx-auto flex aspect-[9/16] max-h-64 w-36 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500">
            {imageUrl ? (
              <img src={imageUrl} alt="Story preview" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-semibold text-white/90">Voice story</span>
            )}
            <button
              type="button"
              onClick={() => { setImage(null); if (!audio) reset(); }}
              aria-label="Remove photo"
              className={`absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white ${imageUrl ? "" : "hidden"}`}
            >
              ×
            </button>
          </div>

          {audio && audioUrl ? (
            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <AudioPlayer src={audioUrl} durationMs={audio.durationMs} peaks={peaks} />
              </div>
              <button
                type="button"
                onClick={() => { setAudio(null); setPeaks([]); }}
                aria-label="Remove voice"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              {isAudioRecordingSupported() && (
                <button type="button" onClick={() => void recorder.start()} className={btnSecondary}>Add voice</button>
              )}
            </div>
          )}
          {!image && (
            <button type="button" onClick={() => fileInputRef.current?.click()} className={`${btnSecondary} self-center`}>
              Add photo
            </button>
          )}

          <input
            value={caption}
            maxLength={150}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Add a caption…"
            className={input}
          />

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-gray-600">Visible to</span>
            <AudiencePicker value={audience} onChange={setAudience} />
          </div>

          <div className="rounded-2xl border border-gray-200 p-3">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-800">Add a meetup</span>
              <input
                type="checkbox"
                checked={withMeetup}
                onChange={(event) => { setWithMeetup(event.target.checked); setError(null); }}
                className="h-5 w-5 accent-[#1D9BF0]"
              />
            </label>
            {withMeetup && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <MeetupFields draft={meetup} onChange={setMeetup} withNote={false} />
              </div>
            )}
          </div>
        </div>
      )}
      {recorder.error && (
        <div role="alert" className="mt-3 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="min-w-0 flex-1">{recorder.error}</p>
          {isAudioRecordingSupported() && (
            <button type="button" onClick={() => void recorder.start()} className="shrink-0 font-semibold underline">
              Try again
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
