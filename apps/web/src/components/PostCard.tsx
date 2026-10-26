import { memo, useEffect, useRef, useState } from "react";
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
import ImageLightbox from "./ImageLightbox.js";

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
  mediaPriority = false,
}: {
  post: FeedPost;
  seen?: boolean;
  currentUserId?: string;
  onDeleted?: (postId: string) => void;
  mediaPriority?: boolean;
}) {
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translationVisible, setTranslationVisible] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
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
        <PostVideo key={`${post.id}:${post.imageKey}`} mediaKey={post.imageKey} priority={mediaPriority} />
      ) : post.imageKey && (
        <button type="button" aria-label={`Enlarge photo by @${post.author.username}`} onClick={() => setPhotoOpen(true)} className="mt-2 block w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
          <ProgressiveImage mediaKey={post.imageKey} className="rounded-lg" priority={mediaPriority} />
        </button>
      )}
      {photoOpen && post.imageKey && <ImageLightbox mediaKey={post.imageKey} onClose={() => setPhotoOpen(false)} />}
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

function PostVideo({ mediaKey, priority }: { mediaKey: string; priority: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const poster = mediaPosterUrl(mediaKey);
  return (
    <div className="relative mx-auto mt-2 flex min-h-48 max-h-[32rem] w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100">
      <img
        src={poster}
        alt=""
        aria-hidden="true"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "low"}
        decoding="async"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
      />
      <img
        src={poster}
        alt=""
        aria-hidden="true"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "low"}
        decoding="async"
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${ready ? "opacity-0" : "opacity-100"}`}
      />
      <video
        ref={videoRef}
        src={`${mediaUrl(mediaKey)}#t=0.1`}
        poster={poster}
        aria-label="Post video"
        controls
        playsInline
        preload="metadata"
        onLoadedData={() => { setReady(true); setFailed(false); }}
        onError={() => setFailed(true)}
        className={`relative mx-auto block h-auto min-h-48 max-h-[32rem] w-auto max-w-full object-contain transition-opacity duration-300 ${ready && !failed ? "opacity-100" : "opacity-0"}`}
      />
      {!ready && !failed && (
        <span role="status" aria-label="Loading post video" className="absolute inset-0 flex items-center justify-center">
          <span aria-hidden="true" className="h-10 w-10 animate-spin rounded-full border-[3px] border-gray-900/15 border-t-gray-900/60 shadow-lg motion-reduce:animate-none" />
        </span>
      )}
      {failed && (
        <button type="button" onClick={() => { setFailed(false); videoRef.current?.load(); }} className="absolute z-10 rounded bg-black/70 px-4 py-2 text-sm text-white">
          Retry video
        </button>
      )}
    </div>
  );
}

export default memo(PostCard);
