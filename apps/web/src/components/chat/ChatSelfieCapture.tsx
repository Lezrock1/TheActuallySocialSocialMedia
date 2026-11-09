import { useEffect, useRef, useState } from "react";

export default function ChatSelfieCapture({ onCapture, onClose }: { onCapture: (image: Blob) => Promise<void>; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const request = navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user" }, audio: false });
    if (!request) {
      setError("Camera unavailable. Check your browser permissions.");
      return;
    }
    void request
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!cancelled) setReady(true);
      })
      .catch(() => { if (!cancelled) setError("Camera unavailable. Check your browser permissions."); });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function capture() {
    const video = videoRef.current;
    if (!video || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const side = Math.min(video.videoWidth, video.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext("2d");
      if (!side || !context) throw new Error("Could not capture photo.");
      const sx = (video.videoWidth - side) / 2;
      const sy = (video.videoHeight - side) / 2;
      context.translate(side, 0);
      context.scale(-1, 1);
      context.drawImage(video, sx, sy, side, side, 0, 0, side, side);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("Could not capture photo.");
      await onCapture(blob);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send selfie.");
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="React with a selfie" onClick={() => !busy && onClose()} className="fixed inset-0 z-[85] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm">
      <section onClick={(event) => event.stopPropagation()} className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-gray-950 p-4 text-white shadow-2xl">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          {!ready && !error && <span role="status" className="absolute inset-0 grid place-items-center text-sm text-white/70">Starting camera…</span>}
        </div>
        {error && <p role="alert" className="text-center text-sm text-red-200">{error}</p>}
        <div className="flex w-full items-center justify-between">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-full px-4 text-sm font-semibold text-white/80 hover:bg-white/10">Cancel</button>
          <button type="button" disabled={!ready || busy} onClick={() => void capture()} aria-label="Take and send selfie" className="flex h-16 w-16 items-center justify-center rounded-full border-[5px] border-white bg-fuchsia-500 shadow-lg transition-transform active:scale-90 disabled:opacity-50">
            {busy ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <span aria-hidden="true" className="h-11 w-11 rounded-full border-2 border-white" />}
          </button>
          <span className="w-16" />
        </div>
      </section>
    </div>
  );
}
