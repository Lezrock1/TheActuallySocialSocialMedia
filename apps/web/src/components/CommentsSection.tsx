import { useEffect, useRef, useState } from "react";
import { getTimeZone } from "../lib/theme.js";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { COMMENT_REACTIONS } from "@app/shared";
import type { Comment } from "@app/shared";
import { ApiError, apiFetch } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import ProgressiveImage from "./ProgressiveImage.js";
import ImageLightbox from "./ImageLightbox.js";
import Avatar from "./Avatar.js";
import LinkedMentions from "./LinkedMentions.js";
import { InlineSkeletonText } from "./LoadingSkeleton.js";

async function fetchComments(postId: string, path: string): Promise<Comment[]> {
  const res = await apiFetch<{ comments: Comment[] }>(path);
  return res.comments;
}

// Mirrors the server's reaction counting so a tap shows its result immediately.
function withReaction(comment: Comment, emoji: string): Comment {
  const previous = comment.myReaction;
  const next = previous === emoji ? null : emoji;
  const counts = new Map(comment.reactions.map((reaction) => [reaction.emoji, reaction.count]));
  if (previous) counts.set(previous, (counts.get(previous) ?? 1) - 1);
  if (next) counts.set(next, (counts.get(next) ?? 0) + 1);
  const reactions = [...counts].filter(([, count]) => count > 0).map(([reactionEmoji, count]) => ({ emoji: reactionEmoji, count })).sort((a, b) => b.count - a.count);
  return { ...comment, myReaction: next, reactions };
}

function CommentItem({
  comment,
  onReply,
  onReact,
  reacting,
}: {
  comment: Comment;
  onReply?: () => void;
  onReact: (emoji: string) => void;
  reacting: boolean;
}) {
  const [zoomed, setZoomed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <Link to={`/u/${comment.author.username}`} className="shrink-0">
        <Avatar avatarKey={comment.author.avatarKey} username={comment.author.username} size={32} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm leading-5 text-gray-800">
          <Link to={`/u/${comment.author.username}`} className="mr-1 font-semibold text-gray-900 hover:underline">
            @{comment.author.username}
          </Link>
          <LinkedMentions text={comment.text} />
        </p>
        {comment.imageKey && (
          !comment.text.trim() ? (
            <>
              <button
                type="button"
                onClick={() => setZoomed(true)}
                aria-label="View selfie reaction full size"
                className="reaction-bubble mt-1.5 block h-16 w-16 cursor-zoom-in overflow-hidden rounded-full border-2 border-fuchsia-200 p-0 shadow-sm transition-transform hover:scale-105 active:scale-95"
              >
                <ProgressiveImage mediaKey={comment.imageKey} className="h-full w-full rounded-full object-cover" />
              </button>
              {zoomed && <ImageLightbox mediaKey={comment.imageKey} onClose={() => setZoomed(false)} />}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setZoomed(true)}
                aria-label="View photo full size"
                className="mt-2 block w-52 max-w-full cursor-zoom-in overflow-hidden rounded-xl transition-transform active:scale-[0.98]"
              >
                <ProgressiveImage mediaKey={comment.imageKey} className="rounded-xl" />
              </button>
              {zoomed && <ImageLightbox mediaKey={comment.imageKey} onClose={() => setZoomed(false)} />}
            </>
          )
        )}
        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
          <time dateTime={comment.createdAt}>
            {new Date(comment.createdAt).toLocaleString("en-US", {
              timeZone: getTimeZone(),
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          {onReply && (
            <button type="button" onClick={onReply} className="font-semibold hover:text-black">
              Reply
            </button>
          )}
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            disabled={reacting}
            aria-expanded={pickerOpen}
            aria-label="React with an emoji"
            className={`font-semibold hover:text-black disabled:opacity-50 ${comment.myReaction ? "text-fuchsia-600" : ""}`}
          >
            {comment.myReaction ? `${comment.myReaction} Reacted` : "React"}
          </button>
        </div>
        {pickerOpen ? (
          <div className="mt-1.5 flex w-fit items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-1 shadow-sm">
            {COMMENT_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => { setPickerOpen(false); onReact(emoji); }}
                disabled={reacting}
                aria-label={`React with ${emoji}`}
                aria-pressed={comment.myReaction === emoji}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-base transition-[background-color,transform] hover:bg-gray-100 active:scale-90 disabled:opacity-50 ${comment.myReaction === emoji ? "bg-fuchsia-50 ring-1 ring-fuchsia-300" : ""}`}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
        ) : (
          comment.reactions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {comment.reactions.map((reaction) => (
                <button
                  key={reaction.emoji}
                  type="button"
                  onClick={() => onReact(reaction.emoji)}
                  disabled={reacting}
                  aria-pressed={comment.myReaction === reaction.emoji}
                  aria-label={`${reaction.count} reacted with ${reaction.emoji}`}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-[background-color,transform] active:scale-95 disabled:opacity-50 ${comment.myReaction === reaction.emoji ? "border-fuchsia-300 bg-fuchsia-50 font-semibold text-fuchsia-700" : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
                >
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span>{reaction.count}</span>
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default function CommentsSection({
  postId,
  repostId,
  commentCount,
  onCommentAdded,
}: {
  postId?: string;
  repostId?: string;
  commentCount: number;
  onCommentAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const targetId = repostId ?? postId;
  const targetPath = repostId ? `/external/reposts/${repostId}/comments` : `/posts/${postId}/comments`;
  const [showAllComments, setShowAllComments] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [likingId, setLikingId] = useState<string | null>(null);
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["comments", targetId],
    queryFn: () => fetchComments(targetId!, targetPath),
    enabled: !!targetId,
  });
  const shownCount = comments.length > 0 ? comments.length : commentCount;

  useEffect(() => {
    if (replyTarget) inputRef.current?.focus();
  }, [replyTarget]);

  const repliesByParent = new Map<string, Comment[]>();
  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    const replies = repliesByParent.get(comment.parentCommentId) ?? [];
    replies.push(comment);
    repliesByParent.set(comment.parentCommentId, replies);
  }
  const rootComments = comments.filter((comment) => !comment.parentCommentId);
  const previewComments = showAllComments ? comments : comments.slice(0, 3);
  const previewIds = new Set(previewComments.map((comment) => comment.id));

  function renderCommentTree(comment: Comment, depth = 0) {
    const children = (repliesByParent.get(comment.id) ?? []).filter((reply) => previewIds.has(reply.id));
    const pending = comment.id.startsWith("pending-");
    return (
      <div key={comment.id} className={`comment-enter flex flex-col gap-2 transition-opacity duration-200 ${pending ? "pointer-events-none opacity-60" : ""}`}>
        <CommentItem
          comment={comment}
          onReply={() => {
            setShowAllComments(true);
            setReplyTarget(comment);
          }}
          onReact={(emoji) => void reactToComment(comment, emoji)}
          reacting={likingId === comment.id}
        />
        {children.length > 0 && (
          <div
            className="flex flex-col gap-2 border-l border-gray-100 pl-3"
            style={{ marginLeft: depth < 4 ? 16 : 0 }}
          >
            {children.map((child) => renderCommentTree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  async function onSelectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      setImageKey(await uploadMedia(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload this photo");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if ((!text.trim() && !imageKey) || posting || uploading || !targetId) return;
    const draft = { text: text.trim(), imageKey, replyTarget };
    const pendingId = `pending-${Date.now()}`;
    setError(null);
    // Show the comment and reset the form straight away; roll back if the server refuses it.
    if (user) {
      queryClient.setQueryData<Comment[]>(["comments", targetId], (current) => [
        ...(current ?? []),
        {
          id: pendingId, author: user, text: draft.text, imageKey: draft.imageKey,
          parentCommentId: draft.replyTarget?.id ?? null, replyCount: 0, likeCount: 0, likedByMe: false,
          reactions: [], myReaction: null, createdAt: new Date().toISOString(),
        },
      ]);
      setShowAllComments(true);
      setText("");
      setImageKey(null);
      setReplyTarget(null);
    } else {
      setPosting(true);
    }
    try {
      const res = await apiFetch<{ comment: Comment }>(targetPath, {
        method: "POST",
        body: JSON.stringify({
          text: draft.text,
          imageKey: draft.imageKey ?? undefined,
          parentCommentId: draft.replyTarget?.id,
        }),
      });
      queryClient.setQueryData<Comment[]>(["comments", targetId], (current) => {
        const rest = (current ?? []).filter((comment) => comment.id !== pendingId);
        return rest.some((comment) => comment.id === res.comment.id) ? rest : [...rest, res.comment];
      });
      if (repostId) {
        void queryClient.invalidateQueries({ queryKey: ["feed", "first"] });
        void queryClient.invalidateQueries({ queryKey: ["feed"] });
      }
      onCommentAdded();
      setShowAllComments(true);
      setText("");
      setImageKey(null);
      setReplyTarget(null);
    } catch (err) {
      queryClient.setQueryData<Comment[]>(["comments", targetId], (current) => (current ?? []).filter((comment) => comment.id !== pendingId));
      setText((current) => current || draft.text);
      setImageKey((current) => current ?? draft.imageKey);
      setReplyTarget((current) => current ?? draft.replyTarget);
      setError(err instanceof ApiError ? err.message : "Could not post comment");
    } finally {
      setPosting(false);
    }
  }

  async function reactToComment(comment: Comment, emoji: string) {
    setLikingId(comment.id);
    setError(null);
    queryClient.setQueryData<Comment[]>(["comments", targetId], (current) =>
      (current ?? []).map((item) => (item.id === comment.id ? withReaction(item, emoji) : item)));
    try {
      if (comment.myReaction === emoji) {
        await apiFetch(`/comments/${comment.id}/like`, { method: "DELETE" });
      } else {
        await apiFetch(`/comments/${comment.id}/like`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["comments", targetId] });
      void queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: ["comments", targetId] });
      setError(err instanceof ApiError ? err.message : "Could not update reaction");
    } finally {
      setLikingId(null);
    }
  }

  return (
    <section className="mt-2 border-t border-gray-100 pt-2">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-600">Comments</h3>
        <span className="text-[11px] text-gray-400">{shownCount}</span>
      </div>
      <div className="flex flex-col gap-3">
          <div id={`comments-${targetId}`} className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {isLoading && (
              <div aria-hidden="true" className="space-y-2 py-1">
                <InlineSkeletonText width="w-40" />
                <InlineSkeletonText width="w-52" />
              </div>
            )}
            {rootComments.filter((comment) => previewIds.has(comment.id)).map((comment) => renderCommentTree(comment))}
          </div>
          <form
            onSubmit={(e) => void onSubmit(e)}
            className={`flex flex-col gap-2 ${comments.length > 0 ? "border-t border-gray-100 pt-3" : "pt-0"}`}
          >
            {replyTarget && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Replying to @{replyTarget.author.username}</span>
                <button type="button" onClick={() => setReplyTarget(null)} className="font-semibold hover:text-black">
                  Cancel
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || posting}
                aria-label={imageKey ? "Change photo" : "Add a photo"}
                title={imageKey ? "Change photo" : "Add a photo"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-[background-color,transform] active:scale-90 disabled:opacity-50 ${imageKey ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >
                {uploading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
                    <circle cx="9" cy="10" r="1.6" />
                    <path d="m4 17 5-4.5 3.5 3L15.5 13 20 17" />
                  </svg>
                )}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onSelectImage(e)} />
              <textarea
                ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
                aria-label={replyTarget ? "Write a reply" : "Write a comment"}
                placeholder={replyTarget ? `Reply to @${replyTarget.author.username}...` : "Add a comment..."}
                maxLength={1000}
                rows={1}
                className="min-h-10 min-w-0 flex-1 resize-y rounded-2xl border border-gray-300 px-4 py-2 text-sm focus:border-black focus:outline-none"
              />
              <button
                disabled={(!text.trim() && !imageKey) || posting || uploading}
                className="min-h-10 shrink-0 px-2 text-sm font-semibold text-blue-700 disabled:text-gray-400"
              >
                {posting ? "Posting..." : replyTarget ? "Reply" : "Post"}
              </button>
            </div>
            {imageKey && (
              <div className="relative w-24">
                <img src={mediaUrl(imageKey)} alt="Photo to attach" className="h-24 w-24 rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => setImageKey(null)}
                  aria-label="Remove photo"
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-sm text-white shadow"
                >
                  ×
                </button>
              </div>
            )}
          </form>
          {!isLoading && comments.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllComments((value) => !value)}
              className="self-start text-xs font-semibold text-gray-500 hover:text-black"
            >
              {showAllComments ? "Show fewer comments" : `View all ${commentCount} comments`}
            </button>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}
