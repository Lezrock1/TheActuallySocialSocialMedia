import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { FeedItem, FeedPage as FeedPageType } from "@app/shared";
import { audienceBody, PUBLIC_AUDIENCE } from "../lib/circles.js";
import type { Audience } from "../lib/circles.js";
import AudiencePicker from "../components/AudiencePicker.js";
import { apiFetch } from "../lib/api.js";
import { mediaUrl, uploadMediaWithInfo } from "../lib/upload.js";
import { card, input, btnPrimary, btnSecondary } from "../lib/ui.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import StoriesBar from "../components/StoriesBar.js";
import PostCard from "../components/PostCard.js";
import Avatar from "../components/Avatar.js";
import PullToRefresh from "../components/PullToRefresh.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";

const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;

const COMPOSER_PLACEHOLDERS: Array<[string, number]> = [
  ["What's new?", 40],
  ["What's on your mind?", 30],
  ["What's up?", 10],
  ["What\u2019s your take?", 10],
  ["How we feeling?", 10],
];

function pickComposerPlaceholder(): string {
  let roll = Math.random() * 100;
  for (const [phrase, weight] of COMPOSER_PLACEHOLDERS) {
    roll -= weight;
    if (roll < 0) return phrase;
  }
  return COMPOSER_PLACEHOLDERS[0][0];
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

type FeedRow =
  | {
      key: string;
      kind: "boundary";
    }
  | {
      key: string;
      kind: "post";
      item: Extract<FeedItem, { type: "post" }>;
    }
  | {
      key: string;
      kind: "follow";
      item: Extract<FeedItem, { type: "follow" }>;
    };

export default function FeedPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pages, setPages] = useState<FeedPageType[]>([]);
  const [text, setText] = useState("");
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>(PUBLIC_AUDIENCE);
  const [posting, setPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [postSendError, setPostSendError] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState(pickComposerPlaceholder);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const postSuccessTimeoutRef = useRef<number | null>(null);
  const feedListRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const [virtualScrollMargin, setVirtualScrollMargin] = useState(0);
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

  const feedRows = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [];
    let boundaryShown = false;
    allPages.forEach((page, pageIndex) => {
      page.items.forEach((item, itemIndex) => {
        const showBoundary = page.boundaryIndex === itemIndex && !boundaryShown;
        if (showBoundary) {
          rows.push({ key: `boundary:${pageIndex}:${itemIndex}`, kind: "boundary" });
          boundaryShown = true;
        }
        if (item.type === "post") {
          rows.push({ key: `post:${item.id}`, kind: "post", item });
        } else {
          rows.push({ key: `follow:${item.id}`, kind: "follow", item });
        }
      });
    });
    return rows;
  }, [allPages]);

  useEffect(() => {
    function updateScrollMargin() {
      if (!feedListRef.current) return;
      const rect = feedListRef.current.getBoundingClientRect();
      setVirtualScrollMargin(Math.round(rect.top + window.scrollY));
    }
    updateScrollMargin();
    window.addEventListener("resize", updateScrollMargin);
    window.addEventListener("orientationchange", updateScrollMargin);
    // Composer, banners and stories above the list change its offset.
    const observer = new ResizeObserver(updateScrollMargin);
    observer.observe(pageRef.current ?? document.body);
    return () => {
      window.removeEventListener("resize", updateScrollMargin);
      window.removeEventListener("orientationchange", updateScrollMargin);
      observer.disconnect();
    };
  }, [feedRows.length]);

  const rowVirtualizer = useWindowVirtualizer({
    count: feedRows.length,
    estimateSize: (index) => (feedRows[index]?.kind === "boundary" ? 44 : feedRows[index]?.kind === "follow" ? 56 : 360),
    getItemKey: (index) => feedRows[index]?.key ?? index,
    overscan: 4,
    scrollMargin: virtualScrollMargin,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const cursor = lastPage?.nextCursor;
    const lastVirtual = virtualRows[virtualRows.length - 1];
    if (!cursor || !lastVirtual || loadingMore || loadMoreError) return;
    if (lastVirtual.index >= feedRows.length - 1) {
      void loadMore(cursor);
    }
  }, [feedRows.length, lastPage?.nextCursor, loadMore, loadMoreError, loadingMore, virtualRows]);

  async function submitPostDraft() {
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
    setPostSendError(null);
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
          ...audienceBody(audience),
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
      setMediaNotice(null);
      setAudience(PUBLIC_AUDIENCE);
      setPollEnabled(false);
      setPollQuestion("");
      setPollOptions(["", ""]);
      setPostSendError(null);
      setPlaceholder(pickComposerPlaceholder());
      setPages([]);
      await queryClient.invalidateQueries({ queryKey: ["feed", "first"] });
    } catch (error) {
      setPostSendError(error instanceof Error
        ? `${error.message} · Try again.`
        : "Could not send your post. Try again.");
    } finally {
      setPosting(false);
    }
  }

  const canPost = !!text.trim() || !!imageKey || pollEnabled;

  useEffect(() => {
    if (!text && textareaRef.current) textareaRef.current.style.height = "";
  }, [text]);

  async function onPost(e: FormEvent) {
    e.preventDefault();
    await submitPostDraft();
  }

  async function onSelectImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setComposerError(null);
    setMediaUploading(true);
    setMediaNotice(file.type.startsWith("video/") && file.size > MAX_VIDEO_UPLOAD_BYTES
      ? `Compressing ${formatMegabytes(file.size)} video for upload…`
      : null);
    try {
      const upload = await uploadMediaWithInfo(file);
      setImageKey(upload.key);
      setMediaType(file.type.startsWith("video/") ? "video" : "image");
      setMediaNotice(upload.compressed
        ? `Video reduced from ${formatMegabytes(upload.originalSize)} to ${formatMegabytes(upload.storedSize)} to fit the 50 MB limit.`
        : null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Media upload failed.");
      setMediaNotice(null);
    } finally {
      setMediaUploading(false);
    }
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
    await apiFetch("/notifications/feed/read", { method: "POST" });
    void queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
  }

  const newestItemKey = allPages[0]?.items[0]
    ? `${allPages[0].items[0].type}:${allPages[0].items[0].id}`
    : null;
  useEffect(() => {
    if (newestItemKey) void markCaughtUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestItemKey]);

  const onPostDeleted = useCallback((_postId: string) => {
    setPages([]);
    void queryClient.invalidateQueries({ queryKey: ["feed", "first"] });
  }, [queryClient]);

  return (
    <div ref={pageRef} className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PullToRefresh onRefresh={async () => {
        setPages([]);
        setLoadMoreError(false);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["feed", "first"] }),
          queryClient.invalidateQueries({ queryKey: ["stories"] }),
        ]);
      }} />
      <PageHeader title="Feed" showSearch />
      <NavBar />

      <StoriesBar />

      <form onSubmit={onPost} className={`${card} mb-4 flex flex-col gap-2.5 !p-3`}>
        <div className="flex items-start gap-2.5">
          {user && <span className="mt-0.5 shrink-0"><Avatar avatarKey={user.avatarKey} username={user.username} size={36} /></span>}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-h-10 min-w-0 flex-1 resize-none rounded-2xl border border-transparent bg-gray-50 px-3.5 py-2 text-[15px] leading-6 text-gray-900 placeholder:text-gray-400 transition-colors focus:border-gray-300 focus:bg-white focus:outline-none"
            rows={1}
          />
        </div>
        {imageKey && (mediaType === "video" ? (
          <video src={mediaUrl(imageKey)} controls playsInline preload="metadata" className="max-h-64 w-full rounded-lg bg-black" />
        ) : (
          <img src={mediaUrl(imageKey)} alt="" className="max-h-48 rounded-lg object-cover" />
        ))}
        {mediaNotice && <p role="status" className="text-xs text-blue-700">{mediaNotice}</p>}
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
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t border-gray-100 pt-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setPollEnabled((enabled) => !enabled);
                setComposerError(null);
              }}
              aria-pressed={pollEnabled}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-[background-color,color,transform] active:scale-95 ${pollEnabled ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 20V10M12 20V4M19 20v-7" />
              </svg>
              {pollEnabled ? "Remove poll" : "Add poll"}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={mediaUploading}
              aria-label={imageKey ? "Change photo or video" : "Add photo or video"}
              title={imageKey ? "Change photo or video" : "Add photo or video"}
              className={`flex h-9 w-9 items-center justify-center rounded-full border transition-[background-color,color,transform] active:scale-90 disabled:opacity-50 ${imageKey ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
            >
              {mediaUploading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="m4 17 5-4.5 3.5 3L15.5 13 20 17" />
                </svg>
              )}
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <AudiencePicker value={audience} onChange={setAudience} showHint={false} className="flex-nowrap" />
            <button
              type="submit"
              disabled={posting || mediaUploading || (!canPost && !postSuccess)}
              aria-label={postSuccess ? "Post published" : "Post"}
              className={`${btnPrimary} relative h-9 w-[4.25rem] shrink-0 overflow-hidden rounded-full px-0 text-sm font-semibold transition-[background-color,opacity] duration-300 ease-in-out focus-visible:ring-2 focus-visible:ring-offset-2 ${postSuccess ? "bg-green-600 hover:bg-green-700 focus-visible:ring-green-600" : "bg-black hover:bg-gray-800 focus-visible:ring-black"} ${!canPost && !postSuccess ? "opacity-40" : ""}`}
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
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime"
          disabled={mediaUploading}
          className="hidden"
          onChange={(e) => void onSelectImage(e)}
        />
      </form>

      {postSendError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="min-w-0 flex-1">{postSendError}</span>
          <button
            type="button"
            onClick={() => void submitPostDraft()}
            disabled={posting || mediaUploading}
            className="shrink-0 rounded-lg border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {firstPageQuery.isLoading && <CardListSkeleton rows={3} />}
      {firstPageQuery.isError && (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load the feed. Pull to refresh or try again.
        </p>
      )}

      <div ref={feedListRef} className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {virtualRows.map((virtualRow) => {
          const row = feedRows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start - virtualScrollMargin}px)` }}
            >
              {row.kind === "boundary" ? (
                <div className="my-4 flex items-center gap-2 text-center text-sm text-gray-400">
                  <span className="h-px flex-1 bg-gray-200" />
                  <span>✓ You are all caught up</span>
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
              ) : row.kind === "post" ? (
                <div className="pb-3">
                  <PostCard
                    post={row.item.post}
                    currentUserId={user?.id}
                    onDeleted={onPostDeleted}
                  />
                </div>
              ) : (
                <div className="pb-3">
                  <FollowActivityCard item={row.item} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {lastPage?.nextCursor && (
        <div className="flex min-h-12 items-center justify-center py-3">
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
