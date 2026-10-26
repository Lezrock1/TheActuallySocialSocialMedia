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
