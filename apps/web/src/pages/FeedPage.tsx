import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedPage as FeedPageType } from "@app/shared";
import type { PostVisibility } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import { card, input, btnPrimary, btnSecondary } from "../lib/ui.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import StoriesBar from "../components/StoriesBar.js";
import PostCard from "../components/PostCard.js";
import FollowBox from "../components/FollowBox.js";

async function fetchFeed(cursor: string | null): Promise<FeedPageType> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return apiFetch<FeedPageType>(`/feed?${params.toString()}`);
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

  // Once the newest post in the feed has been displayed, advance the
  // "caught up" marker so it doesn't show as new again next visit.
  async function markCaughtUp() {
    const newestPost = allPages[0]?.posts[0];
    if (newestPost) {
      await apiFetch("/feed/mark-seen", {
        method: "POST",
        body: JSON.stringify({ postId: newestPost.id }),
      });
    }
  }

  const newestPostId = allPages[0]?.posts[0]?.id ?? null;
  useEffect(() => {
    if (newestPostId) void markCaughtUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestPostId]);

  async function onPostDeleted() {
    setPages([]);
    await queryClient.invalidateQueries({ queryKey: ["feed", "first"] });
  }

  let boundaryShown = false;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader title="Feed" />
      <NavBar />

      <FollowBox />

      <form onSubmit={onPost} className={`${card} mb-6 flex flex-col gap-3`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Was gibt's Neues?"
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={btnSecondary}
            >
              {imageKey ? "Bild ändern" : "Bild hinzufügen"}
            </button>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as PostVisibility)}
              className={`${input} py-1.5`}
            >
              <option value="public">Öffentlich</option>
              <option value="close_friends">Nur enge Freunde</option>
            </select>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onSelectImage(e)}
          />
          <button type="submit" disabled={posting} className={btnPrimary}>
            Posten
          </button>
        </div>
      </form>

      <StoriesBar />

      {firstPageQuery.isLoading && <p className="text-sm text-gray-500">Lädt…</p>}

      <div className="flex flex-col gap-3">
        {allPages.map((page, pageIdx) =>
          page.posts.map((post, postIdx) => {
            const showBoundary =
              page.boundaryIndex === postIdx && !boundaryShown;
            if (showBoundary) boundaryShown = true;
            const seen = page.boundaryIndex !== null && postIdx >= page.boundaryIndex;
            return (
              <div key={post.id}>
                {showBoundary && (
                  <div className="my-4 flex items-center gap-2 text-center text-sm text-gray-400">
                    <span className="h-px flex-1 bg-gray-200" />
                    <span>✓ Du bist auf dem neuesten Stand</span>
                    <span className="h-px flex-1 bg-gray-200" />
                  </div>
                )}
                <PostCard
                  post={post}
                  seen={seen}
                  currentUserId={user?.id}
                  onDeleted={() => void onPostDeleted()}
                />
              </div>
            );
          })
        )}
      </div>

      {lastPage?.nextCursor && (
        <button onClick={() => void loadMore()} className={`${btnSecondary} mt-4 w-full`}>
          Weitere Beiträge laden
        </button>
      )}

      {!lastPage?.nextCursor && allPages.length > 0 && (
        <p className="mt-6 text-center text-sm text-gray-400">
          Das war's – keine weiteren Beiträge.
        </p>
      )}
    </div>
  );
}
