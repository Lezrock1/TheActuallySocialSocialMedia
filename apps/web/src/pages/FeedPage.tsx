import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedItem, FeedPage as FeedPageType } from "@app/shared";
import type { PostVisibility } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import { card, input, btnPrimary, btnSecondary } from "../lib/ui.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import StoriesBar from "../components/StoriesBar.js";
import PostCard from "../components/PostCard.js";
import Avatar from "../components/Avatar.js";

async function fetchFeed(cursor: string | null): Promise<FeedPageType> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return apiFetch<FeedPageType>(`/feed?${params.toString()}`);
}

function FollowActivityCard({ item }: { item: Extract<FeedItem, { type: "follow" }> }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Link to={`/u/${item.follower.username}`} aria-label={`View @${item.follower.username}'s profile`}>
          <Avatar
            avatarKey={item.follower.avatarKey}
            username={item.follower.username}
            size={36}
          />
        </Link>
        <p className="min-w-0 flex-1 text-sm text-gray-700">
          <Link to={`/u/${item.follower.username}`} className="font-semibold text-gray-900 hover:underline">
            @{item.follower.username}
          </Link>{" "}
          started following{" "}
          <Link to={`/u/${item.followee.username}`} className="font-semibold text-gray-900 hover:underline">
            @{item.followee.username}
          </Link>
        </p>
        <time className="shrink-0 text-right text-[11px] text-gray-400">
          {new Date(item.createdAt).toLocaleString("en-US")}
        </time>
      </div>
    </article>
  );
}

export default function FeedPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pages, setPages] = useState<FeedPageType[]>([]);
  const [text, setText] = useState("");
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const firstPageQuery = useQuery({
    queryKey: ["feed", "first"],
    queryFn: () => fetchFeed(null),
  });

  const allPages = firstPageQuery.data ? [firstPageQuery.data, ...pages] : pages;
  const lastPage = allPages[allPages.length - 1];

  async function loadMore() {
    if (!lastPage?.nextCursor) return;
    const next = await fetchFeed(lastPage.nextCursor);
    setPages((p) => [...p, next]);
  }

  async function onPost(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !imageKey) return;
    setPosting(true);
    try {
      await apiFetch("/posts", {
        method: "POST",
        body: JSON.stringify({
          text: text || undefined,
          imageKey: imageKey ?? undefined,
          visibility,
        }),
      });
      setText("");
      setImageKey(null);
      setVisibility("public");
      setPages([]);
      await queryClient.invalidateQueries({ queryKey: ["feed", "first"] });
    } finally {
      setPosting(false);
    }
  }

  async function onSelectImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageKey(await uploadMedia(file));
  }

  // Advance the seen marker to the newest item shown in the feed.
  async function markCaughtUp() {
    const newestItem = allPages[0]?.items[0];
    if (newestItem) {
      await apiFetch("/feed/mark-seen", {
        method: "POST",
        body: JSON.stringify({ itemId: newestItem.id, itemType: newestItem.type }),
      });
    }
  }

  const newestItemKey = allPages[0]?.items[0]
    ? `${allPages[0].items[0].type}:${allPages[0].items[0].id}`
    : null;
  useEffect(() => {
    if (newestItemKey) void markCaughtUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestItemKey]);

  async function onPostDeleted() {
    setPages([]);
    await queryClient.invalidateQueries({ queryKey: ["feed", "first"] });
  }

  let boundaryShown = false;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader title="Feed" showSearch />
      <NavBar />

      <StoriesBar />

      <form onSubmit={onPost} className={`${card} mb-6 flex flex-col gap-3`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's new?"
          className={`${input} resize-none`}
          rows={3}
        />
        {imageKey && (
          <img
            src={mediaUrl(imageKey)}
            alt=""
            className="max-h-48 rounded-lg object-cover"
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={btnSecondary}
            >
              {imageKey ? "Change image" : "Add image"}
            </button>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as PostVisibility)}
              className={`${input} min-w-0 max-w-full py-1.5`}
            >
              <option value="public">Public</option>
              <option value="close_friends">Close friends only</option>
            </select>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onSelectImage(e)}
          />
          <button type="submit" disabled={posting} className={`${btnPrimary} min-h-10 shrink-0`}>
            Post
          </button>
        </div>
      </form>

      {firstPageQuery.isLoading && <p className="text-sm text-gray-500">Loading...</p>}

      <div className="flex flex-col gap-3">
        {allPages.map((page) =>
          page.items.map((item, itemIdx) => {
            const showBoundary =
              page.boundaryIndex === itemIdx && !boundaryShown;
            if (showBoundary) boundaryShown = true;
            return (
              <div key={`${item.type}:${item.id}`}>
                {showBoundary && (
                  <div className="my-4 flex items-center gap-2 text-center text-sm text-gray-400">
                    <span className="h-px flex-1 bg-gray-200" />
                    <span>✓ You are all caught up</span>
                    <span className="h-px flex-1 bg-gray-200" />
                  </div>
                )}
                {item.type === "post" ? (
                  <PostCard
                    post={item.post}
                    currentUserId={user?.id}
                    onDeleted={() => void onPostDeleted()}
                  />
                ) : (
                  <FollowActivityCard item={item} />
                )}
              </div>
            );
          })
        )}
      </div>

      {lastPage?.nextCursor && (
        <button onClick={() => void loadMore()} className={`${btnSecondary} mt-4 w-full`}>
          Load more posts
        </button>
      )}

      {!lastPage?.nextCursor && allPages.length > 0 && (
        <p className="mt-6 text-center text-sm text-gray-400">
          You're all out of posts.
        </p>
      )}
    </div>
  );
}
