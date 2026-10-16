import { useEffect, useRef, useState } from "react";

export default function PlaybackProgress({ durationMs, paused, ready, label, onComplete }: {
  durationMs: number;
  paused: boolean;
  ready: boolean;
  label: string;
  onComplete: () => void;
}) {
  const elapsedRef = useRef(0);
  const completedRef = useRef(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [elapsed, setElapsed] = useState(0);
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!ready || paused || hidden || completedRef.current) return;
    const started = performance.now();
    const tick = () => {
      const total = Math.min(durationMs, elapsedRef.current + performance.now() - started);
      setElapsed(total);
      if (total >= durationMs && !completedRef.current) {
        completedRef.current = true;
        completeRef.current();
      }
    };
    const timer = window.setInterval(tick, 50);
    return () => {
      window.clearInterval(timer);
      elapsedRef.current = Math.min(durationMs, elapsedRef.current + performance.now() - started);
    };
  }, [durationMs, ready, paused, hidden]);
  const progress = Math.min(100, elapsed / Math.max(1, durationMs) * 100);
  return <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="block h-full w-full overflow-hidden rounded-full bg-white/30">
    <span className="block h-full bg-white transition-[width] duration-75 ease-linear motion-reduce:transition-none" style={{ width: `${progress}%` }} />
  </span>;
}