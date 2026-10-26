import type { ExternalFeedPost } from "@app/shared";
import { card } from "../lib/ui.js";
import { PLATFORM_META } from "../lib/platforms.js";

/** Feed card for a post from a followed Bluesky/Mastodon/YouTube profile. */
export default function ExternalPostCard({ item }: { item: ExternalFeedPost }) {
  const meta = PLATFORM_META[item.platform];
  const image = item.mediaUrl ?? item.thumbnailUrl;
  return (
    <article className={card}>
      <div className="flex items-center gap-2.5">
        {item.authorAvatarUrl ? (
          <img src={item.authorAvatarUrl} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-500">
            {(item.authorName ?? item.authorHandle).slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{item.authorName ?? item.authorHandle}</p>
          <p className="truncate text-xs text-gray-500">@{item.authorHandle}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
          {meta.label}
        </span>
      </div>
      {item.text && (
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-snug text-gray-800">{item.text}</p>
      )}
      {image && (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-2 block overflow-hidden rounded-lg">
          <img src={image} alt="" loading="lazy" className="max-h-96 w-full rounded-lg object-cover" />
        </a>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <time dateTime={item.publishedAt} className="shrink-0 text-[11px] text-gray-400">
          {new Date(item.publishedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-xs font-semibold hover:underline ${meta.textClass}`}
        >
          Open on {meta.label} ↗
        </a>
      </div>
    </article>
  );
}
