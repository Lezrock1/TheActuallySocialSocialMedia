import { useQuery } from "@tanstack/react-query";
import type { ExternalStoryItem } from "@app/shared";
import { apiFetch } from "../lib/api.js";

/**
 * Story-bar chips for external content: live Twitch streamers (purple, LIVE)
 * and fresh YouTube Shorts (red) from followed channels.
 */
export default function ExternalStoryChips() {
  const { data: items = [] } = useQuery({
    queryKey: ["external-story-items"],
    queryFn: async () => (await apiFetch<{ items: ExternalStoryItem[] }>("/external/story-items")).items,
    staleTime: 5 * 60 * 1000,
  });
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => {
        const image = item.platform === "twitch"
          ? item.authorAvatarUrl
          : item.thumbnailUrl ?? item.authorAvatarUrl;
        return (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={item.live ? `${item.authorName} is live on Twitch: ${item.title}` : `${item.authorName} on YouTube: ${item.title}`}
            title={item.title}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
          >
            <span className={`rounded-full p-0.5 ${item.live ? "bg-gradient-to-br from-purple-500 to-fuchsia-500" : "bg-gradient-to-br from-red-500 to-rose-400"}`}>
              <span className="block h-[52px] w-[52px] overflow-hidden rounded-full border-2 border-white bg-gray-100">
                {image ? (
                  <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-gray-400">
                    {item.authorName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
            </span>
            <span className={`text-[10px] font-semibold ${item.live ? "text-purple-600" : "text-red-600"}`}>
              {item.live ? "LIVE" : "Short"}
            </span>
          </a>
        );
      })}
    </>
  );
}
