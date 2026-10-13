import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MomentFeed, MomentPostItem } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { formatCountdown, useMoment } from "../lib/useMoment.js";
import { mediaPosterUrl, mediaUrl } from "../lib/upload.js";
import { useCamera } from "./camera/CameraProvider.js";
import Avatar from "./Avatar.js";

function Flame({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      title={`${count} Moment streak`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold tabular-nums text-orange-600"
    >
      <span aria-hidden="true">🔥</span>
      {count}
    </span>
  );
}

function lateLabel(post: MomentPostItem): string | null {
  if (!post.late) return null;
  const minutes = Math.max(1, Math.round(post.lateBySeconds / 60));
  return minutes >= 60 ? `${Math.round(minutes / 60)}h late` : `${minutes} min late`;
}

function MomentViewer({
  posts,
  startIndex,
  currentUserId,
  onClose,
  onRetake,
}: {
  posts: MomentPostItem[];
  startIndex: number;
  currentUserId: string | undefined;
  onClose: () => void;
  onRetake: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const post = posts[index];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((value) => Math.min(posts.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, posts.length]);

  if (!post) return null;
  const late = lateLabel(post);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Moment from @${post.user.username}`}
      className="snap-viewer-enter fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black"
      onClick={onClose}
    >
      <div className="absolute inset-x-4 top-[max(0.5rem,env(safe-area-inset-top))] z-20 flex gap-1" aria-hidden="true">
        {posts.map((item, itemIndex) => (
          <span key={item.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
            {itemIndex <= index && <span className="block h-full w-full bg-white" />}
          </span>
        ))}
      </div>
      <div
        className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/30 to-transparent px-4 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Avatar avatarKey={post.user.avatarKey} username={post.user.username} size={30} />
          <span>@{post.user.username}</span>
          {late && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">{late}</span>}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Moment"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xl leading-none hover:bg-white/25"
        >
          ×
        </button>
      </div>

      {post.mediaType === "video" ? (
        <video
          key={post.id}
          src={mediaUrl(post.imageKey)}
          poster={mediaPosterUrl(post.imageKey)}
          autoPlay
          playsInline
          controls
          loop
          onClick={(event) => event.stopPropagation()}
          className="max-h-screen max-w-full object-contain"
        />
      ) : (
        <img
          key={post.id}
          src={mediaUrl(post.imageKey)}
          alt={`Moment from @${post.user.username}`}
          onClick={(event) => event.stopPropagation()}
          className="snap-media-enter max-h-screen max-w-full object-contain"
        />
      )}

      {index > 0 && (
        <button
          type="button"
          aria-label="Previous Moment"
          onClick={(event) => { event.stopPropagation(); setIndex(index - 1); }}
          className="absolute inset-y-24 left-0 z-10 w-1/4"
        />
      )}
      {index < posts.length - 1 && (
        <button
          type="button"
          aria-label="Next Moment"
          onClick={(event) => { event.stopPropagation(); setIndex(index + 1); }}
          className="absolute inset-y-24 right-0 z-10 w-1/4"
        />
      )}

      <div
        className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-gradient-to-t from-black/75 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-16"
        onClick={(event) => event.stopPropagation()}
      >
        {post.caption && (
          <p className="max-w-[90vw] rounded-full bg-black/55 px-4 py-2 text-center text-sm text-white backdrop-blur-md">{post.caption}</p>
        )}
        {post.user.id === currentUserId && (
          <button
            type="button"
            onClick={onRetake}
            className="rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/25"
          >
            Delete and retake
          </button>
        )}
      </div>
    </div>
  );
}

// Feed card for today's Moment: secret wait, live countdown, late posting and the friends' Moments.
export default function MomentCard() {
  const { summary, status, remainingMs, progress } = useMoment();
  const camera = useCamera();
  const queryClient = useQueryClient();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const started = status === "open" || status === "late";
  const { data: feed } = useQuery({
    queryKey: ["moment", "feed", summary?.myPost?.id ?? "none"],
    queryFn: () => apiFetch<MomentFeed>("/moments/today/feed"),
    enabled: started,
    refetchInterval: 30_000,
  });

  if (!summary || status === "none") return null;

  const myPost = summary.myPost;
  const posts = feed?.posts ?? [];

  async function retake() {
    setViewerIndex(null);
    await apiFetch("/moments/today/post", { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["moment"] });
    camera.openMoment();
  }

  if (status === "waiting") {
    return (
      <section aria-label="Today's Moment" className="mb-3 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fuchsia-50 text-fuchsia-600">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">Today's Moment</h2>
          <p className="text-xs leading-5 text-gray-500">Could happen any minute. We'll ping you when it's time.</p>
        </div>
        <Flame count={summary.currentStreak} />
      </section>
    );
  }

  if (!myPost) {
    const open = status === "open";
    return (
      <section
        aria-label="Today's Moment"
        className={`mb-3 overflow-hidden rounded-2xl shadow-lg ${open ? "bg-gradient-to-br from-fuchsia-600 via-pink-500 to-orange-400 text-white" : "border border-amber-200 bg-amber-50 text-amber-950"}`}
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">{open ? "It's Moment time!" : "You missed the window"}</h2>
            <p className={`text-xs leading-5 ${open ? "text-white/85" : "text-amber-900/80"}`}>
              {open ? "Show what you're doing right now." : "You can still share it. It'll be marked as late."}
            </p>
            {feed?.locked && feed.friendPostCount > 0 && (
              <p className={`mt-1 text-xs font-semibold ${open ? "text-white" : "text-amber-900"}`}>
                {feed.friendPostCount} {feed.friendPostCount === 1 ? "friend has" : "friends have"} already posted. Share yours to see.
              </p>
            )}
          </div>
          {open && (
            <span className="shrink-0 text-2xl font-bold tabular-nums" aria-live="off">{formatCountdown(remainingMs)}</span>
          )}
        </div>
        {open && (
          <div className="mx-4 h-1.5 overflow-hidden rounded-full bg-white/30" aria-hidden="true">
            <span className="block h-full rounded-full bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 px-4 pb-3.5 pt-3">
          <button
            type="button"
            onClick={camera.openMoment}
            className={`min-h-10 rounded-full px-5 text-sm font-bold shadow-sm transition-transform active:scale-95 ${open ? "bg-white text-fuchsia-700" : "bg-amber-900 text-white"}`}
          >
            {open ? "Capture now" : "Post late"}
          </button>
          {summary.currentStreak > 0 && (
            <span className="text-xs font-semibold tabular-nums">🔥 {summary.currentStreak} streak at stake</span>
          )}
        </div>
      </section>
    );
  }

  const myLate = lateLabel(myPost);
  const friendPosts = posts.filter((post) => post.user.id !== myPost.user.id);
  return (
    <>
      <section aria-label="Today's Moment" className="mb-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">Today's Moment</h2>
            <p className="text-xs text-gray-500">
              {friendPosts.length > 0 ? `${friendPosts.length} ${friendPosts.length === 1 ? "friend" : "friends"} shared` : "You're first. Friends will show up here."}
            </p>
          </div>
          <Flame count={summary.currentStreak} />
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {posts.map((post, index) => (
            <button
              key={post.id}
              type="button"
              onClick={() => setViewerIndex(index)}
              aria-label={`Open Moment from @${post.user.username}`}
              className="flex w-16 shrink-0 flex-col items-center gap-1 transition-transform active:scale-95"
            >
              <span className={`block rounded-full p-0.5 ${post.user.id === myPost.user.id ? "bg-gradient-to-br from-fuchsia-500 to-orange-400" : "bg-gradient-to-br from-gray-700 to-gray-900"}`}>
                <img
                  src={post.mediaType === "video" ? mediaPosterUrl(post.imageKey) : mediaUrl(post.imageKey)}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 rounded-full border-2 border-white object-cover"
                />
              </span>
              <span className="max-w-full truncate text-[11px] text-gray-600">{post.user.id === myPost.user.id ? "You" : `@${post.user.username}`}</span>
              {post.late && <span className="-mt-1 text-[10px] font-medium text-amber-600">late</span>}
            </button>
          ))}
        </div>
        {myLate && <p className="mt-1 px-1 text-[11px] text-amber-600">Yours was {myLate}. Next time, be quick for the full streak glow.</p>}
      </section>
      {viewerIndex !== null && (
        <MomentViewer
          posts={posts}
          startIndex={viewerIndex}
          currentUserId={myPost.user.id}
          onClose={() => setViewerIndex(null)}
          onRetake={() => void retake()}
        />
      )}
    </>
  );
}
