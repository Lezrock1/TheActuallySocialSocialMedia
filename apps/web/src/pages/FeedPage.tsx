import { useCallback, useEffect, useRef, useState } from "react";
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
import { usePageBackground } from "../lib/pageBackground.js";

async function fetchFeed(cursor: string | null): Promise<FeedPageType> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return apiFetch<FeedPageType>(`/feed?${params.toString()}`);
}

function FollowActivityCard({ item }: { item: Extract<FeedItem, { type: "follow" }> }) {
  return (
    <article className="px-1 py-1.5">
      <div className="flex items-center gap-2.5 border-l-2 border-gray-200 pl-3">
        <Avatar avatarKey={item.follower.avatarKey} username={item.follower.username} size={28} />
        <p className="min-w-0 flex-1 text-xs leading-5 text-gray-500">
          <Link to={`/u/${item.follower.username}`} className="font-semibold text-gray-700 hover:underline">
            @{item.follower.username}
          </Link>{" "}
          followed{" "}
          <Link to={`/u/${item.followee.username}`} className="font-semibold text-gray-700 hover:underline">
            @{item.followee.username}
          </Link>
        </p>
        <time className="shrink-0 text-[10px] text-gray-400">
          {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </time>
      </div>
    </article>
  );
}

export default function FeedPage() {
  const { user } = useAuth();
  usePageBackground("feed");
  const queryClient = useQueryClient();
  const [pages, setPages] = useState<FeedPageType[]>([]);
  const [text, setText] = useState("");
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [posting, setPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const postSuccessTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  useEffect(() => () => {
    if (postSuccessTimeoutRef.current !== null) {
      window.clearTimeout(postSuccessTimeoutRef.current);
    }
  }, []);

  const firstPageQuery = useQuery({
    queryKey: ["feed", "first"],
    queryFn: () => fetchFeed(null),
  });

  const allPages = firstPageQuery.data ? [firstPageQuery.data, ...pages] : pages;
  const lastPage = allPages[allPages.length - 1];

  const loadMore = useCallback(async (cursor: string) => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const next = await fetchFeed(cursor);
      setPages((current) => [...current, next]);
    } catch {
      setLoadMoreError(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const cursor = lastPage?.nextCursor;
    const sentinel = loadMoreSentinelRef.current;
    if (!cursor || !sentinel) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMore && !loadMoreError) {
        void loadMore(cursor);
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [lastPage?.nextCursor, loadMore, loadMoreError, loadingMore]);

  async function onPost(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !imageKey && !pollEnabled) return;
    const normalizedOptions = pollOptions.map((option) => option.trim()).filter(Boolean);
    if (pollEnabled && (!pollQuestion.trim() || normalizedOptions.length < 2)) {
      setComposerError("Add a poll question and at least two answers.");
      return;
    }
    if (pollEnabled && new Set(normalizedOptions.map((option) => option.toLocaleLowerCase())).size !== normalizedOptions.length) {
      setComposerError("Poll answers must be different.");
      return;
    }
    setComposerError(null);
    if (postSuccessTimeoutRef.current !== null) {
      window.clearTimeout(postSuccessTimeoutRef.current);
      postSuccessTimeoutRef.current = null;
    }
    setPostSuccess(false);
    setPosting(true);
    try {
      await apiFetch("/posts", {
        method: "POST",
        body: JSON.stringify({
          text: text || undefined,
          imageKey: imageKey ?? undefined,
          mediaType: imageKey ? mediaType : undefined,
          visibility,
          poll: pollEnabled ? { question: pollQuestion.trim(), options: normalizedOptions } : undefined,
        }),
      });
      setPostSuccess(true);
      postSuccessTimeoutRef.current = window.setTimeout(() => {
        setPostSuccess(false);
        postSuccessTimeoutRef.current = null;
      }, 2000);
      setText("");
      setImageKey(null);
      setMediaType("image");
      setVisibility("public");
      setPollEnabled(false);
      setPollQuestion("");
      setPollOptions(["", ""]);
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
    setMediaType(file.type.startsWith("video/") ? "video" : "image");
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
    <div className="mx-auto max-w-2xl px-4 py-8">
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
        {imageKey && (mediaType === "video" ? (
          <video src={mediaUrl(imageKey)} controls playsInline preload="metadata" className="max-h-64 w-full rounded-lg bg-black" />
        ) : (
          <img src={mediaUrl(imageKey)} alt="" className="max-h-48 rounded-lg object-cover" />
        ))}
        {pollEnabled && (
          <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3">
            <input
              value={pollQuestion}
              onChange={(event) => setPollQuestion(event.target.value)}
              placeholder="Ask a question..."
              maxLength={180}
              className={input}
            />
            {pollOptions.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={option}
                  onChange={(event) => setPollOptions((current) => current.map((value, optionIndex) => optionIndex === index ? event.target.value : value))}
                  placeholder={`Answer ${index + 1}`}
                  maxLength={80}
                  className={`${input} min-w-0 flex-1`}
                />
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setPollOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))}
                    aria-label={`Remove answer ${index + 1}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-gray-500 hover:bg-gray-100"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {pollOptions.length < 4 && (
              <button
                type="button"
                onClick={() => setPollOptions((current) => [...current, ""])}
                className="self-start text-xs font-semibold text-blue-700 hover:underline"
              >
                + Add answer
              </button>
            )}
          </div>
        )}
        {composerError && <p role="alert" className="text-xs text-red-600">{composerError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPollEnabled((enabled) => !enabled);
                setComposerError(null);
              }}
              aria-pressed={pollEnabled}
              className={`${btnSecondary} py-1.5 ${pollEnabled ? "border-blue-500 bg-blue-50 text-blue-700" : ""}`}
            >
              {pollEnabled ? "Remove poll" : "Add poll"}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={btnSecondary}
            >
              {imageKey ? "Change media" : "Add photo or video"}
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
            accept="image/*,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => void onSelectImage(e)}
          />
          <button
            type="submit"
            disabled={posting}
            aria-label={postSuccess ? "Post published" : "Post"}
            className={`${btnPrimary} relative h-10 w-24 shrink-0 overflow-hidden rounded-full px-0 font-semibold transition-colors duration-300 ease-in-out focus-visible:ring-2 focus-visible:ring-offset-2 ${postSuccess ? "bg-green-600 hover:bg-green-700 focus-visible:ring-green-600" : "bg-[#1D9BF0] hover:bg-[#1688D4] focus-visible:ring-[#1D9BF0]"}`}
          >
            <span aria-hidden="true" className={`absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-300 ease-out ${postSuccess ? "scale-90 opacity-0" : "scale-100 opacity-100"}`}>
              Post
            </span>
            <span aria-hidden="true" className={`absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-300 ease-out ${postSuccess ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 4.5 4.5L19 7" />
              </svg>
            </span>
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
        <div ref={loadMoreSentinelRef} className="flex min-h-12 items-center justify-center py-3">
          {loadingMore && <p className="text-xs text-gray-400">Loading more posts...</p>}
          {loadMoreError && (
            <button
              type="button"
              onClick={() => void loadMore(lastPage.nextCursor!)}
              className={`${btnSecondary} text-xs`}
            >
              Retry loading posts
            </button>
          )}
        </div>
      )}

      {!lastPage?.nextCursor && allPages.length > 0 && (
        <p className="mt-6 text-center text-sm text-gray-400">
          You're all out of posts.
        </p>
      )}
    </div>
  );
}
