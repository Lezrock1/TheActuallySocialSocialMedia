import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../lib/api.js";
import { uploadMedia } from "../lib/upload.js";

/**
 * BeReal-style selfie reaction: opens the front camera in a circular frame,
 * captures a square selfie and posts it as a photo comment on the post.
 */
export default function SelfieReaction({
  postId,
  onPosted,
  onClose,
}: {
  postId: string;
  onPosted: () => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!cancelled) setReady(true);
      })
      .catch(() => setError("Camera unavailable – check your browser permissions"));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function capture() {
    const video = videoRef.current;
    if (!video || posting) return;
    setPosting(true);
    setError(null);
    try {
      const side = Math.min(video.videoWidth, video.videoHeight) || 720;
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Capture failed");
      // Center square crop, mirrored like the preview.
      const sx = (video.videoWidth - side) / 2;
      const sy = (video.videoHeight - side) / 2;
      ctx.translate(side, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Capture failed");
      const imageKey = await uploadMedia(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
      await apiFetch(`/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({ text: "", imageKey }),
      });
      onPosted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post your selfie");
      setPosting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Selfie reaction"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex flex-col items-center gap-4" onClick={(event) => event.stopPropagation()}>
        <div className="relative h-64 w-64 overflow-hidden rounded-full border-4 border-white shadow-2xl">
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          {!ready && !error && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="max-w-64 text-center text-sm font-medium text-white">
            {error}
          </p>
        )}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void capture()}
            disabled={!ready || posting}
            aria-label="Take selfie"
            className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-fuchsia-500 shadow-lg transition-transform hover:scale-105 active:scale-90 disabled:opacity-50"
          >
            {posting && (
              <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
