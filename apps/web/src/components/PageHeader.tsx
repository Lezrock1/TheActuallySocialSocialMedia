import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

const menuItem = "flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium text-gray-800 transition-colors hover:bg-gray-50 active:bg-gray-100";
const subItem = "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-gray-600 transition-colors hover:bg-white hover:text-gray-900";

export default function PageHeader({
  title,
  showSearch = true,
}: {
  title: string;
  showSearch?: boolean;
}) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function closeMenu() {
    setMenuOpen(false);
    setSettingsExpanded(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const headerIconButton =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-transparent text-gray-600 transition-[background-color,color,transform] duration-200 hover:bg-gray-100 hover:text-gray-900 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#007AFF]/15 sm:h-9 sm:w-9 sm:border-gray-200";

  function showComingSoon(section: string) {
    setMenuOpen(false);
    setComingSoon(section);
  }

  return (
    <header className="page-header-enter relative z-50 mb-2 flex items-center justify-between">
      <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{title}</h1>
      <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
        <Link to={`/u/${user?.username}`} className="max-w-20 truncate underline sm:max-w-none">
          @{user?.username}
        </Link>
        {showSearch && (
          <Link
            to="/people"
            aria-label="Search friends"
            title="Search friends"
            className={headerIconButton}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6 sm:h-[18px] sm:w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10.8" cy="10.8" r="6.3" />
              <path d="m15.5 15.5 4 4" />
            </svg>
          </Link>
        )}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Open settings menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              if (menuOpen) setSettingsExpanded(false);
              setMenuOpen(!menuOpen);
            }}
            className={headerIconButton}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6 sm:h-[18px] sm:w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.2 2.8h-.4a1.7 1.7 0 0 0-1.7 1.7v.3a1.8 1.8 0 0 1-.9 1.55l-.45.26a1.8 1.8 0 0 1-1.8 0l-.25-.14a1.7 1.7 0 0 0-2.3.62l-.2.35a1.7 1.7 0 0 0 .62 2.3l.25.14a1.8 1.8 0 0 1 .9 1.56v.52a1.8 1.8 0 0 1-.9 1.56l-.25.14a1.7 1.7 0 0 0-.62 2.3l.2.35a1.7 1.7 0 0 0 2.3.62l.25-.14a1.8 1.8 0 0 1 1.8 0l.45.26a1.8 1.8 0 0 1 .9 1.55v.3a1.7 1.7 0 0 0 1.7 1.7h.4a1.7 1.7 0 0 0 1.7-1.7v-.3a1.8 1.8 0 0 1 .9-1.55l.45-.26a1.8 1.8 0 0 1 1.8 0l.25.14a1.7 1.7 0 0 0 2.3-.62l.2-.35a1.7 1.7 0 0 0-.62-2.3l-.25-.14a1.8 1.8 0 0 1-.9-1.56v-.52a1.8 1.8 0 0 1 .9-1.56l.25-.14a1.7 1.7 0 0 0 .62-2.3l-.2-.35a1.7 1.7 0 0 0-2.3-.62l-.25.14a1.8 1.8 0 0 1-1.8 0l-.45-.26a1.8 1.8 0 0 1-.9-1.55v-.3a1.7 1.7 0 0 0-1.7-1.7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="menu-enter absolute right-0 top-full mt-2 w-60 origin-top-right overflow-hidden rounded-2xl border border-gray-200/80 bg-white/95 p-1.5 text-sm shadow-[0_18px_40px_-12px_rgba(15,23,42,0.28)] backdrop-blur-xl"
            >
                <Link to="/settings/ai" role="menuitem" onClick={closeMenu} className={menuItem}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" /></svg>
                  <span>AI Tools</span>
                </Link>
                <Link to="/invitations" role="menuitem" onClick={closeMenu} className={menuItem}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7ZM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z" /></svg>
                  <span className="bg-[linear-gradient(90deg,#ef4444_0%,#f97316_20%,#eab308_40%,#22c55e_60%,#3b82f6_80%,#d946ef_100%)] bg-clip-text font-semibold text-transparent">Invites</span>
                </Link>
                <Link to="/circles" role="menuitem" onClick={closeMenu} className={menuItem}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></svg>
                  <span>Circles</span>
                </Link>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={settingsExpanded}
                onClick={() => setSettingsExpanded((expanded) => !expanded)}
                className={`${menuItem} w-full justify-between text-left ${settingsExpanded ? "bg-gray-50" : ""}`}
              >
                <span className="flex items-center gap-3">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
                  Settings
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${settingsExpanded ? "rotate-180" : ""}`} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${settingsExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="min-h-0 overflow-hidden">
                  <div role="group" aria-label="Settings" className="mx-1 mb-1 mt-0.5 flex flex-col gap-0.5 rounded-xl bg-gray-50 p-1">
                    <Link to="/settings/appearance" role="menuitem" onClick={closeMenu} className={subItem}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></svg>
                      <span>Appearance</span>
                    </Link>
                    <Link to="/settings/account" role="menuitem" onClick={closeMenu} className={subItem}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
                      <span>Account settings</span>
                    </Link>
                    <Link to="/settings/notifications" role="menuitem" onClick={closeMenu} className={subItem}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20a2 2 0 0 0 4 0" /></svg>
                      <span>Notifications</span>
                    </Link>
                    <Link to="/settings/security" role="menuitem" onClick={closeMenu} className={subItem}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
                      <span>Security</span>
                    </Link>
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  setComingSoon("About us");
                }}
                className={`${menuItem} w-full text-left`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0 text-gray-400" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                About us
              </button>
              <div className="mx-2 my-1 border-t border-gray-100" />
              <button
                type="button"
                role="menuitem"
                onClick={() => { closeMenu(); void logout(); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" /></svg>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
      {comingSoon && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
          onClick={() => setComingSoon(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="coming-soon-title"
            className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="coming-soon-title" className="text-base font-semibold">{comingSoon}</h2>
            {comingSoon === "About us" ? (
              <div className="mt-2 text-sm leading-6 text-gray-600">
                <p>
                  InTouch is an open-source and non-profit social space to share moments and stay connected with people. We believe technology, AI, and social media should serve people — not maximize screen time or attention. With a chronological feed, no ads or ranking, plus stories, Snaps, and direct messages, InTouch helps you stay up to date and spend more time together in real life. Our goal is to put people back in control of social media.
                </p>
                <p className="mt-4 font-bold text-gray-900">Power to the people! 🦖</p>
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-gray-600">Coming soon 🦖</p>
            )}
            <button
              type="button"
              onClick={() => setComingSoon(null)}
              className="mt-4 min-h-10 w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
            >
              Close
            </button>
          </section>
        </div>
      )}
    </header>
  );
}
