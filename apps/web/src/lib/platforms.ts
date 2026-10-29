import type { ExternalPlatform } from "@app/shared";

export const PLATFORM_META: Record<
  ExternalPlatform,
  { label: string; badgeClass: string; textClass: string }
> = {
  bluesky: { label: "Bluesky", badgeClass: "bg-sky-100 text-sky-700", textClass: "text-sky-600" },
  mastodon: { label: "Mastodon", badgeClass: "bg-violet-100 text-violet-700", textClass: "text-violet-600" },
  youtube: { label: "YouTube", badgeClass: "bg-red-100 text-red-700", textClass: "text-red-600" },
  twitch: { label: "Twitch", badgeClass: "bg-purple-100 text-purple-700", textClass: "text-purple-600" },
};

/** Filter chip colors: solid brand color when shown, tinted outline when off. */
export const PLATFORM_CHIP: Record<ExternalPlatform, { active: string; inactive: string }> = {
  bluesky: { active: "border-sky-500 bg-sky-500 text-white", inactive: "border-sky-300 bg-sky-50 text-sky-700 opacity-70" },
  mastodon: { active: "border-indigo-500 bg-indigo-500 text-white", inactive: "border-indigo-300 bg-indigo-50 text-indigo-700 opacity-70" },
  youtube: { active: "border-red-600 bg-red-600 text-white", inactive: "border-red-300 bg-red-50 text-red-700 opacity-70" },
  twitch: { active: "border-purple-600 bg-purple-600 text-white", inactive: "border-purple-300 bg-purple-50 text-purple-700 opacity-70" },
};
