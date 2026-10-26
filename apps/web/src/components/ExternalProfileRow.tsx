import type { ExternalProfile } from "@app/shared";
import { activityRow, btnSecondary } from "../lib/ui.js";
import { PLATFORM_META } from "../lib/platforms.js";

/** One row for an external profile: avatar, name, platform badge, follow toggle. */
export default function ExternalProfileRow({
  profile,
  followed,
  live = false,
  pending = false,
  onToggle,
}: {
  profile: ExternalProfile;
  followed: boolean;
  live?: boolean;
  pending?: boolean;
  onToggle: () => void;
}) {
  const meta = PLATFORM_META[profile.platform];
  return (
    <div className={`${activityRow} motion-safe:animate-[menu-enter_220ms_ease-out]`}>
      <a
        href={profile.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" loading="lazy" className="h-[42px] w-[42px] shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-500">
            {(profile.displayName ?? profile.handle).slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-gray-900">
            {profile.displayName || `@${profile.handle}`}
          </span>
          <span className="block truncate text-xs text-gray-500">@{profile.handle}</span>
        </span>
        {live && (
          <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">LIVE</span>
        )}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
          {meta.label}
        </span>
      </a>
      <button
        type="button"
        disabled={pending}
        onClick={onToggle}
        aria-pressed={followed}
        className={`${btnSecondary} shrink-0 text-xs`}
      >
        {followed ? "Following ✓" : "Follow"}
      </button>
    </div>
  );
}
