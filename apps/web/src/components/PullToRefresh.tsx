import { useEffect, useRef, useState } from "react";
import RefreshIndicatorGlyph from "./RefreshIndicatorGlyph.js";
import { resolveRefreshColor, useRefreshAppearance } from "../lib/refreshAppearance.js";

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
  const armedRef = useRef(false);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [appearance] = useRefreshAppearance();
  const color = resolveRefreshColor(appearance.bird, appearance.color);
  refreshRef.current = onRefresh;
  enabledRef.current = enabled;

  function updateIndicator() {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const indicator = indicatorRef.current;
      if (!indicator || refreshingRef.current) return;
      const distance = distanceRef.current;
      const progress = Math.min(distance / REFRESH_THRESHOLD, 1);
      indicator.style.opacity = String(Math.min(distance / 12, 1));
      indicator.style.transform = `translate3d(-50%, ${Math.min(distance * 0.48, 36)}px, 0) scale(${0.82 + progress * 0.18})`;
    });
  }

  function resetIndicator() {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    indicator.style.transition = "opacity 170ms ease-out";
    indicator.style.opacity = "0";
    indicator.style.transform = "translate3d(-50%, 0, 0) scale(.88)";
    window.setTimeout(() => { if (indicatorRef.current === indicator) indicator.style.transition = "opacity 120ms linear"; }, 280);
  }

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
      if (indicatorRef.current) indicatorRef.current.style.transition = "opacity 120ms linear";
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
        armedRef.current = false;
        setArmed(false);
        resetIndicator();
        return;
      }
      if (pull <= 0) {
        distanceRef.current = 0;
        if (armedRef.current) {
          armedRef.current = false;
          setArmed(false);
        }
        updateIndicator();
        return;
      }
      if (pull > 0) {
        if (pull > 8 && event.cancelable) event.preventDefault();
        const nextDistance = Math.min(pull * 0.72, MAX_PULL_DISTANCE);
        distanceRef.current = nextDistance;
        const nextArmed = nextDistance >= REFRESH_THRESHOLD;
        if (nextArmed !== armedRef.current) {
          armedRef.current = nextArmed;
          setArmed(nextArmed);
        }
        updateIndicator();
      }
    }

    function onTouchEnd() {
      startY = null;
      startX = null;
      if (distanceRef.current < REFRESH_THRESHOLD || refreshingRef.current) {
        distanceRef.current = 0;
        armedRef.current = false;
        setArmed(false);
        resetIndicator();
        return;
      }
      distanceRef.current = 0;
      armedRef.current = false;
      refreshingRef.current = true;
      setArmed(false);
      setRefreshing(true);
      const indicator = indicatorRef.current;
      if (indicator) {
        indicator.style.opacity = "1";
        indicator.style.transform = "translate3d(-50%, 0, 0) scale(1)";
      }
      void Promise.resolve().then(() => refreshRef.current()).catch(() => undefined).finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        resetIndicator();
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
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={refreshing ? appearance.bird === "classic" ? "Refreshing" : "Bird flapping, refreshing" : armed ? "Release to refresh" : "Pull to refresh"}
      ref={indicatorRef}
      data-refresh-bird={appearance.bird}
      className="refresh-bird-indicator pointer-events-none fixed left-1/2 top-[max(12px,env(safe-area-inset-top))] z-[70] flex h-10 w-10 -translate-x-1/2 items-center justify-center"
      style={{ color }}
    >
      <RefreshIndicatorGlyph bird={appearance.bird} color={color} animated={armed || refreshing} />
    </div>
  );
}