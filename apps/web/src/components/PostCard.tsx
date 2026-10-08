import { memo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { TRANSLATION_LANGUAGES } from "@app/shared";
import type { FeedPost } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaPosterUrl, mediaUrl } from "../lib/upload.js";
import ProgressiveImage from "./ProgressiveImage.js";
import { card, btnDanger } from "../lib/ui.js";
import Avatar from "./Avatar.js";
import AiChatPanel from "./AiChatPanel.js";
import FactCheckTransparency from "./FactCheckTransparency.js";
import CommentsSection from "./CommentsSection.js";
import PollCard from "./PollCard.js";
import LinkedMentions from "./LinkedMentions.js";
import { detectPostLanguage } from "../lib/translationLanguage.js";
import type { TranslationLanguage } from "@app/shared";
import AppDialog from "./AppDialog.js";

const languageCodes: Record<string, string> = {
  de: "deu",
  en: "eng",
  es: "spa",
  fr: "fra",
  it: "ita",
  pt: "por",
  nl: "nld",
  pl: "pol",
};

function PostCard({
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
  const [translation, setTranslation] = useState<string | null>(null);
  const [translationVisible, setTranslationVisible] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data: translationPreferences } = useQuery({
    queryKey: ["user-preferences"],
    queryFn: () => apiFetch<{ translationLanguage: TranslationLanguage }>("/users/me/preferences"),
  });
  const translationLanguage = translationPreferences?.translationLanguage ?? "de";
  const [sourceLanguage, setSourceLanguage] = useState("und");
  const canTranslate = !!post.text && sourceLanguage !== "und" && sourceLanguage !== languageCodes[translationLanguage];
  const languageLabel = TRANSLATION_LANGUAGES.find((language) => language.code === translationLanguage)?.label ?? "Deutsch";
  const isOwn = currentUserId && post.author.id === currentUserId;

  useEffect(() => {
    setCommentCount(post.commentCount);
  }, [post.commentCount]);

  useEffect(() => {
    let active = true;
    if (!post.text) {
      setSourceLanguage("und");
      return () => { active = false; };
    }
    void detectPostLanguage(post.text)
      .then((language) => { if (active) setSourceLanguage(language); })
      .catch(() => { if (active) setSourceLanguage("und"); });
    return () => { active = false; };
  }, [post.text]);

  async function onDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`/posts/${post.id}`, { method: "DELETE" });
      setDeleteDialogOpen(false);
      onDeleted?.(post.id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete this post.");
    } finally {
      setDeleting(false);
    }
  }

  async function onTranslate() {
    if (translation) {
      setTranslationVisible((visible) => !visible);
      return;
    }
    setTranslationLoading(true);
    setTranslationError(null);
    try {
      const result = await apiFetch<{ translation: string }>("/ai/translate", {
        method: "POST",
        body: JSON.stringify({ postId: post.id }),
      });
      setTranslation(result.translation);
      setTranslationVisible(true);
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "Could not translate this post.");
    } finally {
      setTranslationLoading(false);
    }
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
          {post.visibility === "circle" && (
            <span className="max-w-[9rem] truncate rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-800">
              {post.circle?.name ?? "Private"}
            </span>
          )}
        </div>
        {isOwn && (
          <button onClick={() => setDeleteDialogOpen(true)} className={btnDanger}>
            Delete
          </button>
        )}
      </div>
      {post.text && <p className="whitespace-pre-wrap text-[15px] leading-snug"><LinkedMentions text={post.text} /></p>}
      {canTranslate && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => void onTranslate()}
            disabled={translationLoading}
            aria-expanded={translationVisible}
            className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
          >
            {translationLoading ? "Translating…" : translationVisible ? "Hide translation" : `Translate to ${languageLabel}`}
          </button>
          {translationError && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {translationError} <Link to="/settings/ai" className="font-medium underline">AI Tools</Link>
            </p>
          )}
          {translation && translationVisible && (
            <div className="mt-2 border-l-2 border-blue-300 pl-3">
              <p className="mb-1 text-[10px] font-semibold uppercase text-gray-400">{languageLabel}</p>
              <p className="whitespace-pre-wrap text-[15px] leading-snug">{translation}</p>
            </div>
          )}
        </div>
      )}
      {post.pollId && <PollCard pollId={post.pollId} />}
      {post.imageKey && post.mediaType === "video" ? (
        <video
          src={`${mediaUrl(post.imageKey)}#t=0.1`}
          poster={mediaPosterUrl(post.imageKey)}
          controls
          playsInline
          preload="metadata"
          className="mt-2 max-h-[32rem] w-full rounded-lg bg-black"
        />
      ) : post.imageKey && (
        <ProgressiveImage mediaKey={post.imageKey} className="mt-2 rounded-lg" />
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
      <AppDialog
        open={deleteDialogOpen}
        title="Delete this post?"
        description={deleteError ?? "This cannot be undone."}
        confirmLabel="Delete"
        danger
        pending={deleting}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => void onDelete()}
      />
    </article>
  );
}

export default memo(PostCard);
