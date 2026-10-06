import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

export default function PageHeader({
  title,
  showSearch = true,
}: {
  title: string;
  showSearch?: boolean;
}) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  const headerIconButton =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-none border-0 text-gray-600 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 sm:h-9 sm:w-9 sm:rounded-full sm:border sm:border-gray-200 sm:hover:bg-gray-50";

  function showComingSoon(section: string) {
    setMenuOpen(false);
    setComingSoon(section);
  }

  return (
    <header className="relative z-50 mb-2 flex items-center justify-between">
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
        <div className="relative">
          <button
            type="button"
            aria-label="Open settings menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
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
              className="absolute right-0 top-full mt-2 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
            >
              <Link
                to="/settings/ai"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-2.5 hover:bg-gray-50"
              >
                AI Tools
              </Link>
              <Link
                to="/invitations"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block bg-[linear-gradient(90deg,#ef4444_0%,#f97316_20%,#eab308_40%,#22c55e_60%,#3b82f6_80%,#d946ef_100%)] bg-clip-text px-4 py-2.5 font-semibold text-transparent hover:opacity-75"
              >
                Invites
              </Link>
              <Link
                to="/settings/notifications"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-2.5 hover:bg-gray-50"
              >
                Notifications
              </Link>
              <Link
                to="/settings/account"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-2.5 hover:bg-gray-50"
              >
                Settings
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setComingSoon("About us");
                }}
                className="block w-full px-4 py-2.5 text-left hover:bg-gray-50"
              >
                About us
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button
                type="button"
                role="menuitem"
                onClick={() => void logout()}
                className="block w-full px-4 py-2.5 text-left font-medium text-red-600 hover:bg-red-50"
              >
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
