import { Link } from "react-router-dom";
import type { FeedPost } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaUrl } from "../lib/upload.js";
import { card, btnDanger } from "../lib/ui.js";
import Avatar from "./Avatar.js";
import AiChatPanel from "./AiChatPanel.js";
import FactCheckTransparency from "./FactCheckTransparency.js";
import CommentsSection from "./CommentsSection.js";

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
  const isOwn = currentUserId && post.author.id === currentUserId;

  async function onDelete() {
    if (!confirm("Diesen Post wirklich unwiderruflich löschen?")) return;
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
              Enge Freunde
            </span>
          )}
        </div>
        {isOwn && (
          <button onClick={() => void onDelete()} className={btnDanger}>
            Löschen
          </button>
        )}
      </div>
      {post.text && <p className="whitespace-pre-wrap text-[15px] leading-snug">{post.text}</p>}
      {post.imageKey && (
        <img
          src={mediaUrl(post.imageKey)}
          alt=""
          className="mt-2 max-h-96 w-full rounded-lg object-cover"
        />
      )}
      <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
        <span>{new Date(post.createdAt).toLocaleString("de-DE")}</span>
        <Link to={`/post/${post.id}`} className="font-medium text-gray-600 hover:underline">
          {post.replyCount > 0 ? `${post.replyCount} Antworten` : "Antworten"}
        </Link>
      </div>
      <FactCheckTransparency postId={post.id} />
      <AiChatPanel postId={post.id} />
      <CommentsSection postId={post.id} />
    </article>
  );
}
