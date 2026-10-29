import { useEffect, useState } from "react";

// Slim status bar like native apps show when the connection drops and returns.
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    const goOffline = () => {
      if (timer !== null) window.clearTimeout(timer);
      setRestored(false);
      setOnline(false);
    };
    const goOnline = () => {
      setOnline(true);
      setRestored(true);
      timer = window.setTimeout(() => setRestored(false), 2500);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  if (online && !restored) return null;
  return (
    <div
      role="status"
      className={`banner-enter fixed inset-x-0 top-0 z-[80] px-4 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-xs font-semibold text-white ${online ? "bg-green-600" : "bg-gray-800"}`}
    >
      {online ? "Back online" : "You're offline. Showing what was saved."}
    </div>
  );
}
