import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FeedPost } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaUrl } from "../lib/upload.js";
import { card, btnDanger } from "../lib/ui.js";
import Avatar from "./Avatar.js";
import AiChatPanel from "./AiChatPanel.js";
import FactCheckTransparency from "./FactCheckTransparency.js";
import CommentsSection from "./CommentsSection.js";
import PollCard from "./PollCard.js";
import LinkedMentions from "./LinkedMentions.js";

export default function PostCard({
  post,
  seen,
  currentUserId,
  onDeleted,
}: {
  post: FeedPost;
  seen?: boolean;
  currentUserId?: string;
  onDeleted?: (postId: string) => void;
}) {
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const isOwn = currentUserId && post.author.id === currentUserId;

  useEffect(() => {
    setCommentCount(post.commentCount);
  }, [post.commentCount]);

  async function onDelete() {
    if (!confirm("Permanently delete this post?")) return;
    await apiFetch(`/posts/${post.id}`, { method: "DELETE" });
    onDeleted?.(post.id);
  }

  return (
    <article className={`${card} ${seen ? "opacity-60" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar avatarKey={post.author.avatarKey} username={post.author.username} />
          <Link to={`/u/${post.author.username}`} className="text-sm font-semibold hover:underline">
            @{post.author.username}
          </Link>
          {post.visibility === "close_friends" && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
              Close friends
            </span>
          )}
        </div>
        {isOwn && (
          <button onClick={() => void onDelete()} className={btnDanger}>
            Delete
          </button>
        )}
      </div>
      {post.text && <p className="whitespace-pre-wrap text-[15px] leading-snug"><LinkedMentions text={post.text} /></p>}
      {post.pollId && <PollCard pollId={post.pollId} />}
      {post.imageKey && post.mediaType === "video" ? (
        <video
          src={mediaUrl(post.imageKey)}
          controls
          playsInline
          preload="metadata"
          className="mt-2 max-h-[32rem] w-full rounded-lg bg-black"
        />
      ) : post.imageKey && (
        <img
          src={mediaUrl(post.imageKey)}
          alt=""
          className="mt-2 max-h-96 w-full rounded-lg object-cover"
        />
      )}
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
        <time dateTime={post.createdAt} className="shrink-0 text-[11px] text-gray-400">
          {new Date(post.createdAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
        <div className="min-w-0 flex-1">
          <AiChatPanel postId={post.id} />
        </div>
      </div>
      <CommentsSection
        postId={post.id}
        commentCount={commentCount}
        onCommentAdded={() => setCommentCount((count) => count + 1)}
      />
      <FactCheckTransparency postId={post.id} />
    </article>
  );
}
