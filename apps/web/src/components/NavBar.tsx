import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api.js";
import CameraIcon from "./CameraIcon.js";

const primaryLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-base font-semibold ${isActive ? "text-black underline" : "text-gray-700"}`;

const secondaryLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-xs ${isActive ? "text-gray-600 underline" : "text-gray-400"}`;

const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-w-0 flex-col items-center justify-center border-t-2 px-1 py-2 text-[11px] font-medium ${
    isActive ? "border-black text-black" : "border-transparent text-gray-500"
  }`;

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

  function UnreadBadge() {
    if (!notificationCount) return null;
    return (
      <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-4 text-white">
        {notificationCount > 9 ? "9+" : notificationCount}
      </span>
    );
  }

  function SnapUnreadBadge() {
    if (!snapUnreadCount) return null;
    return (
      <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-[#FFFC00] px-1 text-[9px] font-semibold leading-4 text-black">
        {snapUnreadCount > 9 ? "9+" : snapUnreadCount}
      </span>
    );
  }

  function MessageUnreadBadge() {
    if (!messageUnreadCount) return null;
    return (
      <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-green-600 px-1 text-[9px] font-semibold leading-4 text-white">
        {messageUnreadCount > 9 ? "9+" : messageUnreadCount}
      </span>
    );
  }

  return (
    <>
      <nav aria-label="Primary navigation" className="mx-auto mb-3 hidden max-w-lg items-baseline justify-between border-b pb-2 sm:flex">
        <div className="flex gap-5">
          <NavLink to="/" end className={primaryLinkClass}>
            Feed
          </NavLink>
          <NavLink to="/snaps" className={primaryLinkClass}>
            Snaps <SnapUnreadBadge />
          </NavLink>
          <NavLink to="/dms" className={primaryLinkClass}>
            Messages <MessageUnreadBadge />
          </NavLink>
        </div>
        <div className="flex gap-3">
          <NavLink
            to="/invitations"
            className={({ isActive }) => `bg-[linear-gradient(90deg,#ef4444_0%,#f97316_20%,#eab308_40%,#22c55e_60%,#3b82f6_80%,#d946ef_100%)] bg-clip-text text-xs font-medium text-transparent hover:opacity-75 ${isActive ? "underline decoration-fuchsia-500 underline-offset-4" : ""}`}
          >
            Invite your friends!
          </NavLink>
          <NavLink to="/notifications" className={secondaryLinkClass}>
            Notifications <UnreadBadge />
          </NavLink>
        </div>
      </nav>
      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-gray-200 bg-white/95 px-1 pt-1 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:hidden"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <NavLink to="/" end className={mobileLinkClass}>Feed</NavLink>
        <NavLink to="/snaps" className={mobileLinkClass}>
          <span className="flex items-center">Snaps <SnapUnreadBadge /></span>
        </NavLink>
        <span aria-hidden="true" className="flex min-w-0 flex-col items-center justify-center border-t-2 border-transparent px-1 py-2" />
        <NavLink to="/dms" className={mobileLinkClass}>
          <span className="flex items-center">Messages <MessageUnreadBadge /></span>
        </NavLink>
        <NavLink to="/notifications" className={mobileLinkClass}>
          <span>Alerts</span><UnreadBadge />
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
