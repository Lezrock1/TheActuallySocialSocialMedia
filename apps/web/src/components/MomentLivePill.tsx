import { useLocation } from "react-router-dom";
import { formatCountdown, useMoment } from "../lib/useMoment.js";
import { useCamera } from "./camera/CameraProvider.js";

// Shows on every page except the feed (which has the full card) while the on-time window is open.
export default function MomentLivePill() {
  const { summary, status, remainingMs } = useMoment();
  const camera = useCamera();
  const location = useLocation();

  if (status !== "open" || summary?.myPost || remainingMs <= 0 || location.pathname === "/") return null;

  return (
    <button
      type="button"
      data-moment-pill
      onClick={camera.openMoment}
      aria-label={`Moment is live, ${formatCountdown(remainingMs)} left. Capture now`}
      className="menu-enter fixed left-1/2 top-[max(0.5rem,env(safe-area-inset-top))] z-[55] flex -translate-x-1/2 items-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-600 via-pink-500 to-orange-400 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-fuchsia-900/30 transition-transform active:scale-95"
    >
      <span aria-hidden="true" className="live-ring h-2 w-2 rounded-full bg-white" />
      Moment is live
      <span className="tabular-nums">{formatCountdown(remainingMs)}</span>
    </button>
  );
}
