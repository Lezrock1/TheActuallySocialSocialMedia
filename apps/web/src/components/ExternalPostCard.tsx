import type { ExternalFeedPost } from "@app/shared";
import { getTimeZone } from "../lib/theme.js";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api.js";
import { card } from "../lib/ui.js";
import { PLATFORM_META } from "../lib/platforms.js";
import AiChatPanel from "./AiChatPanel.js";
import PostTranslation from "./PostTranslation.js";

/** Feed card for a post from a followed Bluesky/Mastodon/YouTube profile. */
export default function ExternalPostCard({ item, onRepostChanged }: { item: ExternalFeedPost; onRepostChanged?: () => void }) {
  const meta = PLATFORM_META[item.platform];
  const image = item.mediaUrl ?? item.thumbnailUrl;
  const queryClient = useQueryClient();
  const [reposted, setReposted] = useState(!!item.repostedByMe);
  useEffect(() => { setReposted(!!item.repostedByMe); }, [item.repostedByMe]);
  const repost = useMutation({
    mutationFn: () => apiFetch("/external/reposts", {
      method: reposted ? "DELETE" : "POST",
      body: JSON.stringify({ platform: item.platform, externalId: item.externalId, url: item.url }),
    }),
    onSuccess: async () => {
      setReposted((value) => !value);
      onRepostChanged?.();
      await queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });
  return (
    <article className={card}>
      {item.repostedBy && <p className="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0"><path d="m4 8 3-3 3 3M7 5v12h9m4-1-3 3-3-3m3 3V7H8" /></svg>
        <Link to={`/u/${item.repostedBy.username}`} className="truncate font-semibold hover:underline">@{item.repostedBy.username}</Link> reposted
      </p>}
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
      {item.text && item.platform !== "twitch" && <PostTranslation key={`${item.platform}:${item.externalId}:${item.text}`} post={item} />}
      {image && (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-2 block overflow-hidden rounded-lg">
          <img
            src={image}
            alt=""
            loading="lazy"
            className={item.platform === "youtube"
              ? "aspect-video w-full rounded-lg object-cover"
              : "max-h-96 w-full rounded-lg object-cover"}
          />
        </a>
      )}
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
        <time dateTime={item.publishedAt} className="shrink-0 text-[11px] text-gray-400">
          {new Date(item.publishedAt).toLocaleString("en-US", {
            timeZone: getTimeZone(),
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
        <div className="min-w-0 flex-1">
          <AiChatPanel externalPost={item} />
        </div>
      </div>
      {repost.isError && <p role="alert" className="mt-2 text-xs text-red-600">Could not update your repost. Try again.</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        {item.platform !== "twitch" && <button type="button" title={reposted ? "Undo repost" : "Repost to your followers"}
          aria-label={reposted ? "Undo repost" : "Repost"} aria-pressed={reposted} disabled={repost.isPending}
          onClick={() => repost.mutate()}
          className={`flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors disabled:opacity-50 ${reposted ? "bg-emerald-50 text-emerald-700" : "text-gray-500 hover:bg-gray-50"}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]"><path d="m4 8 3-3 3 3M7 5v12h9m4-1-3 3-3-3m3 3V7H8" /></svg>
          {repost.isPending ? "Saving..." : reposted ? "Reposted" : "Repost"}
        </button>}
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
