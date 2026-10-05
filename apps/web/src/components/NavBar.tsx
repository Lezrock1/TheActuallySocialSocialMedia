import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api.js";
import CameraIcon from "./CameraIcon.js";

const primaryLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-base font-semibold ${isActive ? "text-black underline" : "text-gray-700"}`;

const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-[10px] font-medium leading-none transition-colors ${
    isActive ? "text-[#1DA1F2]" : "text-gray-500 hover:text-gray-800"
  }`;

function MobileTabIcon({
  name,
  className = "h-[23px] w-[23px]",
}: {
  name: "feed" | "snaps" | "messages" | "alerts";
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "feed" && <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>}
      {name === "snaps" && <><rect x="3" y="6" width="18" height="15" rx="3" /><path d="m8 6 1.5-3h5L16 6" /><circle cx="12" cy="13.5" r="3.5" /></>}
      {name === "messages" && <path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5a7.5 7.5 0 1 1 17.5-3Z" />}
      {name === "alerts" && <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>}
    </svg>
  );
}

function CountBadge({
  count,
  tone,
}: {
  count: number;
  tone: "red" | "green" | "yellow";
}) {
  if (!count) return null;
  const toneClass = {
    red: "bg-red-600 text-white",
    green: "bg-green-600 text-white",
    yellow: "bg-[#FFFC00] text-black ring-1 ring-yellow-500/60",
  }[tone];
  return (
    <span className={`absolute -right-2 -top-1.5 z-10 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-4 shadow-sm ring-2 ring-white ${toneClass}`}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

export default function NavBar() {
  const { data: { unreadCount: notificationCount = 0, messageUnreadCount = 0 } = {} } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiFetch<{ unreadCount: number; messageUnreadCount: number }>("/notifications/unread-count"),
    staleTime: 30_000,
      refetchInterval: 30_000,
  });
  const { data: snapUnreadCount = 0 } = useQuery({
    queryKey: ["snaps", "unread-count"],
    queryFn: () => apiFetch<{ unreadCount: number }>("/snaps/unread-count").then((result) => result.unreadCount),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  return (
    <>
      <nav aria-label="Primary navigation" className="mx-auto mb-3 hidden max-w-lg items-baseline justify-between border-b pb-2 sm:flex">
        <div className="flex gap-5">
          <NavLink to="/" end className={primaryLinkClass}>
            Feed
          </NavLink>
          <NavLink to="/snaps" className={primaryLinkClass}>
            <span className="inline-flex items-center gap-1.5">
              <span className="relative inline-flex">
                <MobileTabIcon name="snaps" className="h-5 w-5" />
                <CountBadge count={snapUnreadCount} tone="yellow" />
              </span>
              Snaps
            </span>
          </NavLink>
          <NavLink to="/dms" className={primaryLinkClass}>
            <span className="inline-flex items-center gap-1.5">
              <span className="relative inline-flex">
                <MobileTabIcon name="messages" className="h-5 w-5" />
                <CountBadge count={messageUnreadCount} tone="green" />
              </span>
              Messages
            </span>
          </NavLink>
        </div>
        <div className="flex gap-3">
          <NavLink
            to="/invitations"
            className={({ isActive }) => `bg-[linear-gradient(90deg,#ef4444_0%,#f97316_20%,#eab308_40%,#22c55e_60%,#3b82f6_80%,#d946ef_100%)] bg-clip-text text-xs font-medium text-transparent hover:opacity-75 ${isActive ? "underline decoration-fuchsia-500 underline-offset-4" : ""}`}
          >
            Invite your friends!
          </NavLink>
          <NavLink
            to="/notifications"
            className={({ isActive }) => `inline-flex items-center gap-2 text-xs ${isActive ? "text-gray-700" : "text-gray-500"}`}
          >
            <span className="relative inline-flex">
              <MobileTabIcon name="alerts" className="h-5 w-5" />
              <CountBadge count={notificationCount} tone="red" />
            </span>
            <span>Notifications</span>
          </NavLink>
        </div>
      </nav>
      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-stretch gap-1 border-t border-white/70 bg-white/85 px-3 pt-1 shadow-[0_-8px_28px_rgba(15,23,42,0.09)] backdrop-blur-xl sm:hidden"
        style={{ paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))" }}
      >
        <NavLink to="/" end className={mobileLinkClass}>
          <MobileTabIcon name="feed" />
          <span>Feed</span>
        </NavLink>
        <NavLink to="/snaps" className={mobileLinkClass}>
          <span className="relative inline-flex">
            <MobileTabIcon name="snaps" />
            <CountBadge count={snapUnreadCount} tone="yellow" />
          </span>
          <span>Snaps</span>
        </NavLink>
        <span aria-hidden="true" className="min-w-0" />
        <NavLink to="/dms" className={mobileLinkClass}>
          <span className="relative inline-flex">
            <MobileTabIcon name="messages" />
            <CountBadge count={messageUnreadCount} tone="green" />
          </span>
          <span>Messages</span>
        </NavLink>
        <NavLink to="/notifications" className={mobileLinkClass}>
          <span className="relative inline-flex">
            <MobileTabIcon name="alerts" />
            <CountBadge count={notificationCount} tone="red" />
          </span>
          <span>Alerts</span>
        </NavLink>
        <NavLink
          to="/snaps?camera=1"
          aria-label="Open camera"
          className="absolute left-1/2 top-0 z-50 flex h-16 w-16 -translate-x-1/2 -translate-y-[30%] items-center justify-center rounded-full bg-fuchsia-600 text-white shadow-lg ring-4 ring-white transition hover:bg-fuchsia-700 active:scale-95"
        >
          <CameraIcon />
        </NavLink>
      </nav>
    </>
  );
}
