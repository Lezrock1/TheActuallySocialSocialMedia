import { useEffect, useRef, useState } from "react";

const REFRESH_THRESHOLD = 78;
const MAX_PULL_DISTANCE = 88;

export default function PullToRefresh({
  onRefresh,
  enabled = true,
}: {
  onRefresh: () => Promise<unknown>;
  enabled?: boolean;
}) {
  const refreshRef = useRef(onRefresh);
  const enabledRef = useRef(enabled);
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  refreshRef.current = onRefresh;
  enabledRef.current = enabled;

  useEffect(() => {
    let startY: number | null = null;
    let startX: number | null = null;

    function onTouchStart(event: TouchEvent) {
      if (!enabledRef.current || refreshingRef.current || event.touches.length !== 1) return;
      if (window.scrollY > 1 || document.documentElement.scrollTop > 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, video, audio, [contenteditable='true']")) return;

      let element = target instanceof HTMLElement ? target : null;
      while (element && element !== document.body) {
        const overflowY = window.getComputedStyle(element).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1) {
          if (element.scrollTop > 1) return;
        }
        element = element.parentElement;
      }
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
    }

    function onTouchMove(event: TouchEvent) {
      if (startY === null || startX === null || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const pull = touch.clientY - startY;
      const horizontal = Math.abs(touch.clientX - startX);
      if (horizontal > Math.max(14, Math.abs(pull) * 0.65)) {
        startY = null;
        startX = null;
        distanceRef.current = 0;
        setDistance(0);
        return;
      }
      if (pull <= 0) {
        distanceRef.current = 0;
        setDistance(0);
        return;
      }
      if (pull > 8) {
        if (event.cancelable) event.preventDefault();
        const nextDistance = Math.min(pull * 0.72, MAX_PULL_DISTANCE);
        distanceRef.current = nextDistance;
        setDistance(nextDistance);
      }
    }

    function onTouchEnd() {
      startY = null;
      startX = null;
      if (distanceRef.current < REFRESH_THRESHOLD || refreshingRef.current) {
        distanceRef.current = 0;
        setDistance(0);
        return;
      }
      distanceRef.current = 0;
      refreshingRef.current = true;
      setDistance(0);
      setRefreshing(true);
      void Promise.resolve().then(() => refreshRef.current()).catch(() => undefined).finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      });
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const shown = distance > 0 || refreshing;
  const translateY = refreshing ? 12 : Math.min(distance - 44, 28);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
      className="pointer-events-none fixed left-1/2 top-[max(8px,env(safe-area-inset-top))] z-[70] flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-gray-100 bg-white text-[#1D9BF0] shadow-lg transition-[opacity,transform] duration-150"
      style={{ opacity: shown ? 1 : 0, transform: `translate(-50%, ${translateY}px)` }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={`h-5 w-5 ${refreshing || distance >= REFRESH_THRESHOLD ? "animate-spin" : ""}`}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />
      </svg>
      <span className="sr-only">{refreshing ? "Refreshing" : ""}</span>
    </div>
  );
}