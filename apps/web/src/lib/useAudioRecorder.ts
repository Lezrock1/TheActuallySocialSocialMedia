import { useCallback, useEffect, useRef, useState } from "react";

export interface AudioRecording {
  blob: Blob;
  durationMs: number;
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function isAudioRecordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export function useAudioRecorder({
  maxMs,
  onFinished,
}: {
  maxMs: number;
  onFinished?: (recording: AudioRecording) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const frameRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const teardown = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setRecording(false);
    setLevel(0);
  }, []);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    teardown();
  }, [teardown]);

  const start = useCallback(async () => {
    if (recorderRef.current?.state === "recording") return;
    setError(null);
    if (!isAudioRecordingSupported()) {
      setError("Recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        teardown();
        if (!cancelledRef.current && blob.size > 0) onFinishedRef.current?.({ blob, durationMs });
      };
      recorderRef.current = recorder;

      const AudioContextClass = window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        audioContextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
          setLevel(Math.min(1, peak / 64));
          frameRef.current = requestAnimationFrame(tick);
        };
        tick();
      }

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      recorder.start(250);
      setRecording(true);
    } catch (caught) {
      teardown();
      setError(
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it for InTouch in your browser or device settings, then try again."
          : caught instanceof DOMException && caught.name === "NotFoundError"
            ? "No microphone was found. You can still send a photo or text."
            : caught instanceof DOMException && caught.name === "NotReadableError"
              ? "The microphone is busy in another app. Close it and try again."
              : "Could not start recording. You can still send a photo or text."
      );
    }
  }, [teardown]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= maxMs && recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [maxMs, recording]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else teardown();
  }, [teardown]);

  return { recording, elapsedMs, level, error, start, stop, cancel };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
