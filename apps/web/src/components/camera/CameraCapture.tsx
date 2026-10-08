import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  isVideoRecordingSupported,
  MAX_CAMERA_VIDEO_MS,
  MIN_CAMERA_VIDEO_MS,
  pickVideoMimeType,
  videoFileExtension,
} from "../../lib/video.js";
import { formatDuration } from "../../lib/useAudioRecorder.js";

type CameraFailure = "denied" | "unavailable" | "unsupported" | "error";
type FacingMode = "environment" | "user";
type TimerSeconds = 0 | 3 | 10;

interface TrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
}

const TIMERS: TimerSeconds[] = [0, 3, 10];

function IconButton({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md transition-[background-color,transform] active:scale-90 disabled:opacity-40 ${active ? "bg-white text-black" : "bg-black/35 text-white hover:bg-black/50"}`}
    >
      {children}
    </button>
  );
}

const iconProps = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-[22px] w-[22px]",
};

function FailurePanel({
  failure,
  onRetry,
  onPickFile,
}: {
  failure: CameraFailure;
  onRetry: () => void;
  onPickFile: () => void;
}) {
  const copy = {
    denied: {
      title: "Camera access is off",
      text: "Allow the camera for InTouch: on iPhone open Settings › Safari › Camera, on Android tap the lock icon in the address bar › Permissions. Then try again.",
    },
    unavailable: { title: "No camera found", text: "This device has no camera available right now. You can still pick a photo." },
    unsupported: { title: "Camera unavailable here", text: "Your browser blocks the camera on this page. Pick a photo instead." },
    error: { title: "The camera could not start", text: "Another app might be using it. Close it and try again." },
  }[failure];
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white">
        <svg {...iconProps} className="h-8 w-8">
          <path d="M3 3l18 18M9.5 5h5L16 7h3a2 2 0 0 1 2 2v8M5 7H4a1 1 0 0 0-1 1v10a2 2 0 0 0 2 2h13" />
          <path d="M10 10a3.5 3.5 0 0 0 4 5" />
        </svg>
      </span>
      <h3 className="text-lg font-semibold text-white">{copy.title}</h3>
      <p className="max-w-xs text-sm leading-6 text-white/70">{copy.text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {failure !== "unsupported" && (
          <button type="button" onClick={onRetry} className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-black active:scale-95">
            Try again
          </button>
        )}
        <button type="button" onClick={onPickFile} className="min-h-11 rounded-full border border-white/40 px-5 text-sm font-semibold text-white active:scale-95">
          Choose a photo
        </button>
      </div>
    </div>
  );
}

export default function CameraCapture({
  onCaptured,
  onClose,
  onPickFile,
}: {
  onCaptured: (file: File) => void;
  onClose: () => void;
  onPickFile: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pointerStartsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const [facing, setFacing] = useState<FacingMode>("environment");
  const [nonce, setNonce] = useState(0);
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [ready, setReady] = useState(false);
  const [capabilities, setCapabilities] = useState<TrackCapabilities>({});
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [timer, setTimer] = useState<TimerSeconds>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; key: number } | null>(null);
  const [flipTurns, setFlipTurns] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdActiveRef = useRef(false);
  const releasedRef = useRef(false);
  const recordStartRef = useRef(0);
  const stopDrawingRef = useRef<(() => void) | null>(null);
  const facingRef = useRef<FacingMode>("environment");
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  facingRef.current = facing;

  // Start (and restart) the camera stream; stop it whenever the tab is hidden.
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    function stop() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      trackRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    async function start() {
      setFailure(null);
      setReady(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setFailure("unsupported");
        return;
      }
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        const track = next.getVideoTracks()[0];
        trackRef.current = track;
        const caps = (track.getCapabilities?.() ?? {}) as TrackCapabilities;
        setCapabilities({ torch: !!caps.torch, zoom: caps.zoom });
        setTorchOn(false);
        setZoom(1);
        if (videoRef.current) {
          videoRef.current.srcObject = next;
          await videoRef.current.play();
        }
        if (!cancelled) setReady(true);
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        setFailure(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "unavailable"
              : "error"
        );
      }
    }

    function onVisibility() {
      if (document.hidden) {
        stop();
        setReady(false);
      } else if (!stream) {
        void start();
      }
    }

    void start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [facing, nonce]);

  const applyAdvanced = useCallback(async (constraint: Record<string, unknown>) => {
    try {
      await trackRef.current?.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }, []);

  async function toggleTorch() {
    const next = !torchOn;
    if (await applyAdvanced({ torch: next })) setTorchOn(next);
  }

  async function setZoomLevel(value: number) {
    const range = capabilities.zoom;
    if (!range) return;
    const clamped = Math.min(range.max, Math.max(range.min, value));
    if (await applyAdvanced({ zoom: clamped })) setZoom(clamped);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointerStartsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      void setZoomLevel(pinchRef.current.zoom * (distance / pinchRef.current.distance));
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const wasSingle = pointersRef.current.size === 1 && !pinchRef.current;
    const start = pointerStartsRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    pointerStartsRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    // A tap (not a drag) focuses at that point; a second quick tap flips the camera.
    if (wasSingle && start && Math.hypot(start.x - event.clientX, start.y - event.clientY) < 8) {
      const now = Date.now();
      const previous = lastTapRef.current;
      if (previous && now - previous.time < 320 && Math.hypot(previous.x - event.clientX, previous.y - event.clientY) < 48) {
        lastTapRef.current = null;
        setFocusPoint(null);
        flipCamera();
        return;
      }
      lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setFocusPoint({ x, y, key: Date.now() });
      void applyAdvanced({
        focusMode: "single-shot",
        pointsOfInterest: [{ x: x / rect.width, y: y / rect.height }],
      });
    }
  }

  function flipCamera() {
    navigator.vibrate?.(10);
    setFlipTurns((turns) => turns + 1);
    setFacing((mode) => (mode === "environment" ? "user" : "environment"));
  }

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (facing === "user") {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setFlashKey((key) => key + 1);
    navigator.vibrate?.(15);
    canvas.toBlob((blob) => {
      if (blob) onCaptured(new File([blob], "camera-snap.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }, [facing, onCaptured]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      takePhoto();
      return;
    }
    const timeout = window.setTimeout(() => setCountdown((value) => (value === null ? null : value - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [countdown, takePhoto]);

  function onShutter() {
    if (!ready) return;
    if (countdown !== null) {
      setCountdown(null);
      return;
    }
    if (timer > 0) setCountdown(timer);
    else takePhoto();
  }

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  async function startRecording() {
    const video = videoRef.current;
    const mimeType = pickVideoMimeType();
    setNotice(null);
    if (!video || video.videoWidth === 0 || !isVideoRecordingSupported() || !mimeType) {
      setNotice("Video recording isn't supported in this browser.");
      return;
    }
    // The microphone is only requested once the user actually starts a video.
    let audio: MediaStream | null = null;
    try {
      audio = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotice("Recording without sound – microphone access is off.");
    }
    audioStreamRef.current = audio;

    // Recording from a canvas keeps the clip going when the camera is flipped mid-recording.
    const ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * ratio) & ~1;
    canvas.height = Math.round(video.videoHeight * ratio) & ~1;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") {
      audio?.getTracks().forEach((track) => track.stop());
      setNotice("Video recording isn't supported in this browser.");
      return;
    }
    let frame = 0;
    const draw = () => {
      const source = videoRef.current;
      if (source && source.videoWidth > 0) {
        const scale = Math.max(canvas.width / source.videoWidth, canvas.height / source.videoHeight);
        const width = source.videoWidth * scale;
        const height = source.videoHeight * scale;
        context.save();
        if (facingRef.current === "user") {
          context.translate(canvas.width, 0);
          context.scale(-1, 1);
        }
        context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        context.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    const canvasStream = canvas.captureStream(30);
    const stopDrawing = () => {
      cancelAnimationFrame(frame);
      canvasStream.getTracks().forEach((track) => track.stop());
    };
    stopDrawingRef.current = stopDrawing;

    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 2_500_000 });
    } catch {
      stopDrawing();
      audio?.getTracks().forEach((track) => track.stop());
      setNotice("Could not start video recording.");
      return;
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stopDrawing();
      stopDrawingRef.current = null;
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      const duration = Date.now() - recordStartRef.current;
      if (duration < MIN_CAMERA_VIDEO_MS || chunks.length === 0) {
        setNotice("Hold the button a bit longer to record a video.");
        return;
      }
      onCaptured(new File(chunks, `camera-video.${videoFileExtension(mimeType)}`, { type: mimeType.split(";")[0] }));
    };
    recorderRef.current = recorder;
    recordStartRef.current = Date.now();
    setRecordMs(0);
    recorder.start(250);
    setRecording(true);
    navigator.vibrate?.(20);
    // Finger was lifted while the microphone prompt was open.
    if (releasedRef.current) recorder.stop();
  }

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function onShutterPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!ready || countdown !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    releasedRef.current = false;
    holdActiveRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      holdActiveRef.current = true;
      void startRecording();
    }, 350);
  }

  function onShutterPointerUp() {
    clearHoldTimer();
    releasedRef.current = true;
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      stopRecording();
      return;
    }
    onShutter();
  }

  function onShutterPointerCancel() {
    clearHoldTimer();
    releasedRef.current = true;
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      stopRecording();
    }
  }

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - recordStartRef.current;
      setRecordMs(Math.min(elapsed, MAX_CAMERA_VIDEO_MS));
      if (elapsed >= MAX_CAMERA_VIDEO_MS) stopRecording();
    }, 100);
    return () => window.clearInterval(interval);
  }, [recording, stopRecording]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => () => {
    clearHoldTimer();
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state === "recording") recorder.stop();
    }
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    stopDrawingRef.current?.();
  }, []);

  const zoomRange = capabilities.zoom;
  const canZoom = !!zoomRange && zoomRange.max > zoomRange.min;
  const twoX = canZoom ? Math.min(2, zoomRange!.max) : 1;

  return (
    <div className="absolute inset-0 flex flex-col bg-black">
      <div
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`h-full w-full object-cover transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"} ${facing === "user" ? "-scale-x-100" : ""}`}
        />
        {!ready && !failure && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
          </div>
        )}
        {failure && <FailurePanel failure={failure} onRetry={() => setNonce((value) => value + 1)} onPickFile={onPickFile} />}

        {focusPoint && (
          <span
            key={focusPoint.key}
            style={{ left: focusPoint.x - 36, top: focusPoint.y - 36 }}
            className="focus-ring-pulse pointer-events-none absolute h-[72px] w-[72px] rounded-full border-2 border-yellow-300"
          />
        )}
        {flashKey > 0 && <div key={flashKey} className="shutter-flash pointer-events-none absolute inset-0 bg-white" />}
        {recording && (
          <div className="pointer-events-none absolute inset-x-0 top-[max(1rem,env(safe-area-inset-top))] flex justify-center">
            <span className="flex items-center gap-2 rounded-full bg-red-600 px-3.5 py-1.5 text-sm font-semibold tabular-nums text-white shadow-lg">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              {formatDuration(recordMs)}
            </span>
          </div>
        )}
        {notice && (
          <p role="status" className="pointer-events-none absolute inset-x-6 bottom-20 rounded-2xl bg-black/65 px-4 py-2.5 text-center text-xs leading-5 text-white backdrop-blur-md">
            {notice}
          </p>
        )}
        {countdown !== null && countdown > 0 && (
          <div key={countdown} className="countdown-pop pointer-events-none absolute inset-0 flex items-center justify-center text-[8rem] font-bold text-white drop-shadow-lg">
            {countdown}
          </div>
        )}

        <div className="absolute inset-x-0 top-0 flex items-start justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <IconButton label="Close camera" onClick={onClose} disabled={recording}>
            <svg {...iconProps}><path d="M6 6l12 12M18 6 6 18" /></svg>
          </IconButton>
          <div className={`flex flex-col items-center gap-2 ${recording ? "invisible" : ""}`}>
            {capabilities.torch && (
              <IconButton label={torchOn ? "Turn flash off" : "Turn flash on"} onClick={() => void toggleTorch()} active={torchOn}>
                <svg {...iconProps}><path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" /></svg>
              </IconButton>
            )}
            <button
              type="button"
              onClick={() => setTimer((value) => TIMERS[(TIMERS.indexOf(value) + 1) % TIMERS.length])}
              aria-label={timer ? `Timer ${timer} seconds` : "Timer off"}
              className={`flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 text-xs font-semibold backdrop-blur-md transition-[background-color,transform] active:scale-90 ${timer ? "bg-white text-black" : "bg-black/35 text-white hover:bg-black/50"}`}
            >
              <svg {...iconProps} className="h-[18px] w-[18px]"><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.5 1.5M9.5 3h5" /></svg>
              {timer ? `${timer}s` : null}
            </button>
          </div>
        </div>

        {canZoom && ready && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <div className="flex items-center gap-1 rounded-full bg-black/40 p-1 backdrop-blur-md">
              {[1, twoX].filter((value, index, list) => list.indexOf(value) === index).map((value) => {
                const selected = Math.abs(zoom - value) < 0.15;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => void setZoomLevel(value)}
                    className={`h-8 min-w-8 rounded-full px-2 text-xs font-semibold transition-colors ${selected ? "bg-white text-black" : "text-white"}`}
                  >
                    {selected ? `${zoom.toFixed(1)}x` : `${value}x`}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <footer className="px-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <p className="mb-3 text-center text-[11px] font-medium tracking-wide text-white/60" aria-live="polite">
          {recording ? "Release to finish · Double-tap to flip" : isVideoRecordingSupported() ? "Tap for photo · Hold for video · Double-tap to flip" : "Tap for photo · Double-tap to flip"}
        </p>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onPickFile}
            disabled={recording}
            aria-label="Choose from photo library"
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/30 bg-white/10 text-white transition-[transform,opacity] active:scale-90 disabled:opacity-30"
          >
            <svg {...iconProps}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3L15.5 13 20 17" /></svg>
          </button>
          <button
            type="button"
            onPointerDown={onShutterPointerDown}
            onPointerUp={onShutterPointerUp}
            onPointerCancel={onShutterPointerCancel}
            onContextMenu={(event) => event.preventDefault()}
            onClick={(event) => { if (event.detail === 0) onShutter(); }}
            disabled={!ready && !recording}
            aria-label={countdown !== null ? "Cancel timer" : recording ? "Recording video" : "Take photo, or hold to record video"}
            style={{ WebkitTouchCallout: "none" }}
            className={`group relative flex h-[5rem] w-[5rem] touch-none select-none items-center justify-center rounded-full border-4 transition-transform disabled:opacity-40 ${recording ? "scale-110 border-transparent" : "border-white active:scale-95"}`}
          >
            {recording && (
              <svg aria-hidden="true" viewBox="0 0 100 100" className="pointer-events-none absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] -rotate-90">
                <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="6" />
                <circle
                  cx="50"
                  cy="50"
                  r="46"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 46}
                  strokeDashoffset={2 * Math.PI * 46 * (1 - recordMs / MAX_CAMERA_VIDEO_MS)}
                />
              </svg>
            )}
            <span
              className={`flex items-center justify-center transition-all duration-150 ${
                recording
                  ? "h-7 w-7 rounded-lg bg-red-500"
                  : `h-[3.7rem] w-[3.7rem] rounded-full group-active:h-[3.2rem] group-active:w-[3.2rem] ${countdown !== null ? "bg-fuchsia-500 text-white" : "bg-white"}`
              }`}
            >
              {countdown !== null && <span className="text-xl font-bold">✕</span>}
            </span>
          </button>
          <button
            type="button"
            onClick={flipCamera}
            aria-label={`Switch to ${facing === "environment" ? "front" : "rear"} camera`}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white transition-transform active:scale-90"
          >
            <svg {...iconProps} style={{ transform: `rotate(${flipTurns * 180}deg)`, transition: "transform 350ms ease" }}>
              <path d="M20 8a8 8 0 0 0-14-2L4 8M4 4v4h4M4 16a8 8 0 0 0 14 2l2-2M20 20v-4h-4" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
