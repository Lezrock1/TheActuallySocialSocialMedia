import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import type { FormEvent } from "react";
import { STORY_REACTIONS } from "@app/shared";
import type { MomentFeed, MomentPostItem, StoryGroup, StoryMeetup } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaPosterUrl, mediaUrl, preloadMediaKeys } from "../lib/upload.js";
import Avatar from "./Avatar.js";
import DecodedImage from "./DecodedImage.js";
import PlaybackProgress from "./PlaybackProgress.js";
import LiveRoomsBar from "./LiveRoomsBar.js";
import RadioRoomsBar from "./music/RadioRoomsBar.js";
import StoryComposer from "./StoryComposer.js";
import AudioPlayer from "./AudioPlayer.js";
import MeetupCard from "./chat/MeetupCard.js";
import MeetupSheet, { meetupToDraft } from "./MeetupFields.js";
import type { MeetupDraft } from "./MeetupFields.js";
import AppDialog from "./AppDialog.js";
import { useAuth } from "../auth/AuthContext.js";
import { clearLocalMeetupReminder, getLocalMeetupReminderMinutes, setLocalMeetupReminder } from "../lib/localMeetupReminders.js";
import { useMoment } from "../lib/useMoment.js";
import { useCamera } from "./camera/CameraProvider.js";
import MomentReactions from "./MomentReactions.js";
import { encryptMessage, type PublicEncryptionKey } from "../lib/encryption.js";
import { registerDeviceEncryptionKey } from "../lib/encryptionRegistration.js";

async function fetchStoryGroups(): Promise<StoryGroup[]> {
  const res = await apiFetch<{ groups: StoryGroup[] }>("/stories");
  return res.groups;
}

interface NetworkInformationLike extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
}

interface StoryLoadingPolicy {
  preloadCount: number;
}

function getStoryLoadingPolicy(): StoryLoadingPolicy {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!connection) return { preloadCount: 2 };
  if (
    connection.saveData
    || connection.effectiveType === "slow-2g"
    || connection.effectiveType === "2g"
    || (connection.downlink !== undefined && connection.downlink < 0.8)
  ) {
    return { preloadCount: 1 };
  }
  if (
    connection.effectiveType === "3g"
    || (connection.downlink !== undefined && connection.downlink <= 2)
  ) {
    return { preloadCount: 2 };
  }
  return { preloadCount: 4 };
}

function StoryVideo({ src, poster, paused, onReady, onWaiting, onEnd }: {
  src: string; poster: string; paused: boolean;
  onReady: (durationMs: number) => void; onWaiting: () => void; onEnd: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let cancelled = false;
    const update = () => {
      if (paused || document.hidden) { video.pause(); return; }
      void video.play().catch(() => {
        if (cancelled || paused || document.hidden) return;
        video.muted = true;
        setMuted(true);
        void video.play().catch(() => undefined);
      });
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", update); };
  }, [src, paused]);

  return (
    <>
      <video
        ref={ref}
        src={src}
        aria-label="Story video"
        poster={poster}
        autoPlay
        playsInline
        muted={muted}
        preload="auto"
        onLoadedData={(event) => { setReady(true); setFailed(false); onReady(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : 7000); }}
        onPlaying={(event) => onReady(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : 7000)}
        onWaiting={onWaiting}
        onEnded={onEnd}
        onError={() => { setFailed(true); onWaiting(); }}
        className={`h-full w-full object-contain ${ready && !failed ? "opacity-100" : "opacity-0"}`}
      />
      {!ready && !failed && <DecodedImage src={poster} alt="Story video preview" className="pointer-events-none absolute inset-0" />}
      {failed && <button type="button" data-viewer-controls aria-label="Retry Story video" onClick={() => { setFailed(false); ref.current?.load(); }} className="absolute z-20 rounded bg-black/70 px-4 py-2 text-sm text-white">Retry video</button>}
      <button
        type="button"
        onClick={() => setMuted((value) => !value)}
        aria-label={muted ? "Turn sound on" : "Turn sound off"}
        data-viewer-controls
        className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-transform active:scale-90"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
          {muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
        </svg>
      </button>
    </>
  );
}

function lateLabel(post: MomentPostItem): string | null {
  if (!post.late) return null;
  const minutes = Math.max(1, Math.round(post.lateBySeconds / 60));
  return minutes >= 60 ? `${Math.round(minutes / 60)}h late` : `${minutes} min late`;
}

function MomentViewer({ posts, startId, onClose }: { posts: MomentPostItem[]; startId: string; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState(startId);
  const index = posts.findIndex((item) => item.id === selectedId);
  const post = posts[index];
  function advance(direction: -1 | 1) {
    const next = posts[index + direction];
    if (next) setSelectedId(next.id);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") advance(1);
      if (event.key === "ArrowLeft") advance(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, posts, index]);

  if (!post) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Today's Moment"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black"
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
          {lateLabel(post) && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">{lateLabel(post)}</span>}
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
          key={`${post.id}:${post.imageKey}`}
          src={mediaUrl(post.imageKey)}
          poster={mediaPosterUrl(post.imageKey)}
          autoPlay
          muted
          playsInline
          controls
          loop
          onClick={(event) => event.stopPropagation()}
          className="max-h-screen max-w-full object-contain"
        />
      ) : (
        <DecodedImage
          key={`${post.id}:${post.imageKey}`}
          src={mediaUrl(post.imageKey)}
          alt={`Moment from @${post.user.username}`}
          className="h-full w-full"
        />
      )}

      {index > 0 && (
        <button
          type="button"
          aria-label="Previous Moment"
          onClick={(event) => { event.stopPropagation(); advance(-1); }}
          className="absolute inset-y-24 left-0 z-10 w-1/4"
        />
      )}
      {index < posts.length - 1 && (
        <button
          type="button"
          aria-label="Next Moment"
          onClick={(event) => { event.stopPropagation(); advance(1); }}
          className="absolute inset-y-24 right-0 z-10 w-1/4"
        />
      )}

      {post.caption && (
        <div className="absolute inset-x-0 bottom-36 z-10 px-4" onClick={(event) => event.stopPropagation()}>
          <p className="mx-auto max-w-[90vw] rounded-full bg-black/55 px-4 py-2 text-center text-sm text-white backdrop-blur-md">
            {post.caption}
          </p>
        </div>
      )}
      <MomentReactions key={post.id} postId={post.id} />
    </div>, document.body
  );
}

export default function StoriesBar() {
  const queryClient = useQueryClient();
  const camera = useCamera();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { summary: momentSummary, status: momentStatus } = useMoment();
  const [composerOpen, setComposerOpen] = useState(false);
  const [meetupBusy, setMeetupBusy] = useState(false);
  const [editingMeetup, setEditingMeetup] = useState<{ id: string; draft: MeetupDraft } | null>(null);
  const [cancelMeetupId, setCancelMeetupId] = useState<string | null>(null);
  const [reminderVersion, setReminderVersion] = useState(0);
  const [viewing, setViewing] = useState<StoryGroup | null>(null);
  const [momentViewer, setMomentViewer] = useState<{ posts: MomentPostItem[]; startId: string } | null>(null);
  const [storyIndex, setStoryIndex] = useState(0);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [storyReadyId, setStoryReadyId] = useState<string | null>(null);
  const [storyHeld, setStoryHeld] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const [videoDurationMs, setVideoDurationMs] = useState(7000);
  const [seenStories, setSeenStories] = useState<Set<string>>(() => new Set());
  const storyOrderRef = useRef<StoryGroup[]>([]);
  const storyGestureRef = useRef<{ x: number; y: number; startedAt: number } | null>(null);
  const suppressStoryTapRef = useRef(false);
  const [loadingPolicy, setLoadingPolicy] = useState(getStoryLoadingPolicy);

  const { data: storyGroups = [] } = useQuery({
    queryKey: ["stories"],
    queryFn: fetchStoryGroups,
    refetchInterval: 30_000,
  });
  const isSeen = (story: StoryGroup["stories"][number]) => !!story.viewedAt || seenStories.has(story.id);
  const groups = [...storyGroups].sort((first, second) => Number(first.stories.every(isSeen)) - Number(second.stories.every(isSeen)));
  const momentStarted = momentStatus === "open" || momentStatus === "late";
  const { data: momentFeed } = useQuery({
    queryKey: ["moment", "stories-bar-feed", momentSummary?.myPost?.id ?? "none"],
    queryFn: () => apiFetch<MomentFeed>("/moments/today/feed"),
    enabled: momentStarted,
    refetchInterval: 30_000,
  });
  const myMoment = momentSummary?.myPost ?? null;
  const momentPosts = momentFeed?.posts ?? (myMoment ? [myMoment] : []);

  const requestedStoryId = searchParams.get("story");
  useEffect(() => {
    if (!requestedStoryId) return;
    const group = groups.find((candidate) => candidate.stories.some((story) => story.id === requestedStoryId));
    if (!group) return;
    const index = group.stories.findIndex((story) => story.id === requestedStoryId);
    storyOrderRef.current = [...groups];
    setViewing(group);
    setStoryIndex(index);
    setSearchParams({}, { replace: true });
  }, [groups, requestedStoryId, setSearchParams]);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    const updatePolicy = () => setLoadingPolicy(getStoryLoadingPolicy());
    connection?.addEventListener("change", updatePolicy);
    return () => connection?.removeEventListener("change", updatePolicy);
  }, []);

  const viewingGroupIndex = viewing
    ? groups.findIndex((group) => group.author.id === viewing.author.id)
    : -1;
  const activeStory = viewing?.stories[storyIndex];
  const storyPaused = storyHeld || replyFocused || replySending || meetupBusy || !!editingMeetup || !!cancelMeetupId;
  function storyLoaded(durationMs?: number) {
    if (!activeStory) return;
    setStoryReadyId(activeStory.id);
    if (durationMs) setVideoDurationMs(durationMs);
  }
  function completeStory() {
    if (!activeStory || isSeen(activeStory)) { advanceStory(1); return; }
    const storyId = activeStory.id;
    setSeenStories((current) => new Set([...current, storyId]));
    void apiFetch(`/stories/${storyId}/view`, { method: "POST" }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["stories"] });
    }).catch(() => {
      setSeenStories((current) => { const next = new Set(current); next.delete(storyId); return next; });
    });
    advanceStory(1);
  }

  useEffect(() => {
    if (!viewing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setViewing(null);
      if ((event.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowRight") advanceStory(1);
      if (event.key === "ArrowLeft") advanceStory(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewing, storyIndex, groups]);

  useEffect(() => {
    const keysToWarm: Array<string | null> = [];
    groups.slice(0, loadingPolicy.preloadCount).forEach((group) => {
      keysToWarm.push(group.stories[0]?.imageKey ?? null);
    });

    if (viewing) {
      keysToWarm.push(
        viewing.stories[storyIndex]?.imageKey ?? null,
        viewing.stories[storyIndex - 1]?.imageKey ?? null,
        viewing.stories[storyIndex + 1]?.imageKey ?? null,
        viewing.author.avatarKey,
        groups[viewingGroupIndex + 1]?.stories[0]?.imageKey ?? null
      );
    }

    if (myMoment) {
      keysToWarm.push(myMoment.imageKey, myMoment.user.avatarKey);
    }
    if (momentViewer) {
      keysToWarm.push(...momentViewer.posts.slice(0, loadingPolicy.preloadCount).map((post) => post.mediaType === "video" ? null : post.imageKey));
    }

    preloadMediaKeys(keysToWarm, { priority: viewing ? "high" : "low" });
  }, [groups, loadingPolicy.preloadCount, momentViewer, myMoment, storyIndex, viewing]);

  function openMomentCircle() {
    if (!momentStarted || !momentSummary) return;
    if (!myMoment) {
      camera.openMoment();
      return;
    }
    const posts = momentPosts.some((post) => post.id === myMoment.id) ? momentPosts : [myMoment, ...momentPosts];
    setMomentViewer({ posts: [...posts], startId: myMoment.id });
  }

  function advanceStory(direction: -1 | 1) {
    if (!viewing) return;
    setStoryReadyId(null);
    setStoryHeld(false);
    setReplyText("");
    setReactionError(null);
    const nextStoryIndex = storyIndex + direction;
    if (nextStoryIndex >= 0 && nextStoryIndex < viewing.stories.length) {
      setStoryIndex(nextStoryIndex);
      return;
    }

    const order = storyOrderRef.current.length ? storyOrderRef.current : groups;
    const groupIndex = order.findIndex((group) => group.author.id === viewing.author.id);
    const nextGroup = order[groupIndex + direction];
    if (!nextGroup) {
      setViewing(null);
      return;
    }
    setViewing(nextGroup);
    setStoryIndex(direction > 0 ? 0 : nextGroup.stories.length - 1);
  }

  function openStoryGroup(group: StoryGroup) {
    storyOrderRef.current = [...groups];
    setStoryReadyId(null);
    setStoryHeld(false);
    setReplyFocused(false);
    setViewing(group);
    const firstUnseen = group.stories.findIndex((story) => !isSeen(story));
    setStoryIndex(firstUnseen >= 0 ? firstUnseen : 0);
    setReplyText("");
    setReactionError(null);
  }

  async function reactToStory(emoji: (typeof STORY_REACTIONS)[number]) {
    if (!viewing) return;
    const storyId = viewing.stories[storyIndex].id;
    setReactionError(null);
    try {
      const reaction = await apiFetch<{
        reactionCounts: { emoji: string; count: number }[];
        myReaction: string | null;
      }>(`/stories/${storyId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      setViewing((current) => current
        ? {
            ...current,
            stories: current.stories.map((story) =>
              story.id === storyId ? { ...story, ...reaction } : story
            ),
          }
        : current);
      await queryClient.invalidateQueries({ queryKey: ["stories"] });
    } catch {
      setReactionError("Could not send this reaction.");
    }
  }

  async function replyToStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = replyText.trim();
    if (!viewing || !message || replySending) return;
    const story = viewing.stories[storyIndex];
    setReplySending(true);
    setReactionError(null);
    try {
      const result = await apiFetch<{ conversationId: string }>("/conversations", {
        method: "POST",
        body: JSON.stringify({ username: viewing.author.username }),
      });
      if (!user) throw new Error("Please sign in to reply");
      await registerDeviceEncryptionKey(user.id);
      const { keys } = await apiFetch<{ keys: PublicEncryptionKey[] }>(`/conversations/${result.conversationId}/encryption-keys`);
      if (!keys.some((key) => key.userId === viewing.author.id)) throw new Error("Your friend needs to open Messages once to enable encrypted replies.");
      const encryptedPayload = await encryptMessage(JSON.stringify({ type: "story_reply", text: message, story: {
        storyId: story.id, imageKey: story.imageKey, authorUsername: viewing.author.username, createdAt: story.createdAt,
      } }), keys);
      await apiFetch(`/conversations/${result.conversationId}/messages`, { method: "POST", body: JSON.stringify({ encryptedPayload, storyId: story.id }) });
      await queryClient.invalidateQueries({ queryKey: ["messages", result.conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setViewing(null);
      setReplyText("");
      navigate(`/dms?conversation=${result.conversationId}`);
    } catch (error) {
      setReactionError(error instanceof Error ? error.message : "Could not send a private reply.");
    } finally {
      setReplySending(false);
    }
  }

  async function toggleMeetup(meetupId: string) {
    if (meetupBusy) return;
    setMeetupBusy(true);
    setReactionError(null);
    try {
      const result = await apiFetch<{ meetup: StoryMeetup | null }>(`/meetups/${meetupId}/going`, { method: "POST" });
      setViewing((current) => current
        ? {
            ...current,
            stories: current.stories.map((story, index) =>
              index === storyIndex ? { ...story, meetup: result.meetup } : story
            ),
          }
        : current);
      await queryClient.invalidateQueries({ queryKey: ["stories"] });
    } catch {
      setReactionError("Could not update your answer.");
    } finally {
      setMeetupBusy(false);
    }
  }

  async function updateStoryMeetup(draft: MeetupDraft) {
    if (!editingMeetup) return;
    const result = await apiFetch<{ meetup: StoryMeetup | null }>(`/meetups/${editingMeetup.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        startsAt: new Date(draft.when).toISOString(),
        place: draft.place.trim(),
      }),
    });
    setViewing((current) => current ? {
      ...current,
      stories: current.stories.map((story, index) => index === storyIndex ? { ...story, meetup: result.meetup } : story),
    } : current);
    if (user && result.meetup) {
      const minutes = getLocalMeetupReminderMinutes(user.id, result.meetup.id);
      if (minutes !== null) {
        await setLocalMeetupReminder(
          user.id,
          result.meetup.id,
          result.meetup.startsAt,
          minutes,
          `/?story=${encodeURIComponent(viewing?.stories[storyIndex]?.id ?? "")}`,
          viewing?.stories[storyIndex]?.id
        );
        setReminderVersion((version) => version + 1);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["stories"] });
    setEditingMeetup(null);
  }

  async function cancelStoryMeetup() {
    if (!cancelMeetupId) return;
    setMeetupBusy(true);
    setReactionError(null);
    try {
      await apiFetch(`/meetups/${cancelMeetupId}/cancel`, { method: "POST" });
      setViewing((current) => current ? {
        ...current,
        stories: current.stories.map((story, index) => index === storyIndex && story.meetup
          ? { ...story, meetup: { ...story.meetup, isCancelled: true } }
          : story),
      } : current);
      if (user) clearLocalMeetupReminder(user.id, cancelMeetupId);
      setReminderVersion((version) => version + 1);
      setCancelMeetupId(null);
      await queryClient.invalidateQueries({ queryKey: ["stories"] });
    } catch {
      setReactionError("Could not cancel this meetup.");
    } finally {
      setMeetupBusy(false);
    }
  }

  async function setStoryReminder(meetupId: string, startsAt: string, minutes: number | null) {
    if (!user || !viewing) return;
    const error = await setLocalMeetupReminder(
      user.id,
      meetupId,
      startsAt,
      minutes,
      `/?story=${encodeURIComponent(viewing.stories[storyIndex].id)}`,
      viewing.stories[storyIndex].id
    );
    if (error) setReactionError(error);
    else {
      setReactionError(null);
      setReminderVersion((version) => version + 1);
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex gap-4 overflow-x-auto pb-2">
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          aria-label="Create a story"
          className="flex shrink-0 flex-col items-center gap-1"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-xl text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-600">
            +
          </span>
          <span className="text-[11px] text-gray-500">Story</span>
        </button>
        <LiveRoomsBar compact />
        <RadioRoomsBar compact />
        {momentSummary && momentStatus !== "none" && (
          <button
            type="button"
            onClick={openMomentCircle}
            aria-label={myMoment ? "Open Today's Moment" : momentStarted ? "Create Today's Moment" : "Today's Moment is waiting"}
            disabled={!momentStarted && !myMoment}
            className="relative flex shrink-0 flex-col items-center gap-1"
          >
            {myMoment ? (
              <span className="rounded-full bg-gradient-to-br from-cyan-400 via-teal-400 to-emerald-500 p-0.5">
                <span className="block rounded-full border-2 border-white">
                  <DecodedImage
                    key={myMoment.imageKey}
                    src={myMoment.mediaType === "video" ? mediaPosterUrl(myMoment.imageKey) : mediaUrl(myMoment.imageKey)}
                    alt=""
                    className="h-[52px] w-[52px] rounded-full"
                    imageClassName="object-cover"
                  />
                </span>
              </span>
            ) : (
              <span className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-cyan-700 ${momentStarted ? "border-cyan-300 bg-cyan-50" : "border-cyan-200 border-dashed bg-cyan-50/70"}`}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                </svg>
              </span>
            )}
            <span className="max-w-[68px] truncate text-[11px] font-semibold text-cyan-700">Moment</span>
            {!myMoment && momentFeed?.locked && momentFeed.friendPostCount > 0 && (
              <span className="absolute -right-1 top-0 rounded-full bg-cyan-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {momentFeed.friendPostCount}
              </span>
            )}
          </button>
        )}
        {groups.map((group) => (
          <button
            key={group.author.id}
            aria-label={`Stories from @${group.author.username}${group.stories.some((story) => !isSeen(story)) ? " · Unseen stories" : " · All seen"}`}
            data-unseen-count={group.stories.filter((story) => !isSeen(story)).length}
            onClick={() => openStoryGroup(group)}
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <span className={`rounded-full p-0.5 ${group.stories.every(isSeen) ? "bg-gray-300" : "bg-emerald-600"}`}>
              <span className="block rounded-full border-2 border-white">
                <DecodedImage key={group.stories[0].imageKey} src={mediaUrl(group.stories[0].imageKey)} alt={group.author.username} className="h-[52px] w-[52px] rounded-full" imageClassName="object-cover" />
              </span>
            </span>
            <span className="max-w-[60px] truncate text-[11px] text-gray-600">@{group.author.username}</span>
          </button>
        ))}
      </div>
      {viewing && activeStory && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black sm:px-3"
          role="dialog"
          aria-modal="true"
          aria-label={`Stories from @${viewing.author.username}`}
          onClick={() => setViewing(null)}
        >
          <div
            className="flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-black sm:h-[min(100dvh,900px)] sm:rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]" aria-label={`Story ${storyIndex + 1} of ${viewing.stories.length}`}>
              {viewing.stories.map((story, index) => (
                <span key={story.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
                  {index < storyIndex && <span className="block h-full bg-white" />}
                  {index === storyIndex && <PlaybackProgress key={story.id} label="Story progress" durationMs={activeStory.videoKey ? videoDurationMs : activeStory.audioDurationMs || 7000} paused={storyPaused} ready={storyReadyId === activeStory.id} onComplete={() => { if (!activeStory.videoKey) completeStory(); }} />}
                </span>
              ))}
            </div>
            <div className="flex shrink-0 items-center justify-between px-3 py-3 text-sm font-medium text-white">
              <Link
                to={`/u/${viewing.author.username}`}
                onClick={() => setViewing(null)}
                aria-label={`Open profile of @${viewing.author.username}`}
                className="-ml-1 flex min-w-0 items-center gap-2 rounded-full py-0.5 pl-1 pr-3 transition-colors hover:bg-white/10 active:bg-white/15"
              >
                <Avatar avatarKey={viewing.author.avatarKey} username={viewing.author.username} size={30} />
                <span className="truncate">@{viewing.author.username}</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0 text-white/55" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
              </Link>
              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="Close stories"
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-white/80 hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            </div>
            <div className="relative flex min-h-0 w-full flex-1 touch-none items-center justify-center overflow-hidden bg-black"
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest("[data-viewer-controls]")) return;
                suppressStoryTapRef.current = false;
                storyGestureRef.current = { x: event.clientX, y: event.clientY, startedAt: performance.now() };
                setStoryHeld(true);
              }}
              onPointerUp={(event) => {
                const gesture = storyGestureRef.current;
                storyGestureRef.current = null;
                setStoryHeld(false);
                if (!gesture) return;
                const deltaX = event.clientX - gesture.x;
                const deltaY = event.clientY - gesture.y;
                if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY)) {
                  suppressStoryTapRef.current = true;
                  advanceStory(deltaX < 0 ? 1 : -1);
                } else if (deltaY > 80) {
                  suppressStoryTapRef.current = true;
                  setViewing(null);
                } else if (performance.now() - gesture.startedAt > 220) suppressStoryTapRef.current = true;
              }}
              onPointerCancel={() => { storyGestureRef.current = null; setStoryHeld(false); suppressStoryTapRef.current = true; }}>
              {viewing.stories[storyIndex].videoKey ? (
                <StoryVideo
                  key={viewing.stories[storyIndex].id}
                  src={mediaUrl(viewing.stories[storyIndex].videoKey!)}
                  poster={mediaUrl(viewing.stories[storyIndex].imageKey)}
                  paused={storyPaused}
                  onReady={storyLoaded}
                  onWaiting={() => setStoryReadyId(null)}
                  onEnd={completeStory}
                />
              ) : (
              <DecodedImage
                key={activeStory.id}
                src={mediaUrl(viewing.stories[storyIndex].imageKey)}
                alt={`Story ${storyIndex + 1} from @${viewing.author.username}`}
                onReady={() => storyLoaded()}
                className="h-full w-full"
              />
              )}
              <button
                type="button"
                onClick={() => { if (!suppressStoryTapRef.current) advanceStory(-1); }}
                aria-label="Previous story"
                className="absolute inset-y-0 left-0 w-[35%]"
              />
              <button
                type="button"
                onClick={() => { if (!suppressStoryTapRef.current) advanceStory(1); }}
                aria-label="Next story"
                className="absolute inset-y-0 right-0 w-[65%]"
              />
              <div
                data-viewer-controls
                className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-3 pb-4 pt-12"
                onClick={(event) => event.stopPropagation()}
              >
                {viewing.stories[storyIndex].audioKey && (
                  <div className="mb-3 flex justify-center rounded-2xl bg-black/40 px-3 py-2 backdrop-blur">
                    <AudioPlayer
                      key={viewing.stories[storyIndex].id}
                      src={mediaUrl(viewing.stories[storyIndex].audioKey!)}
                      durationMs={viewing.stories[storyIndex].audioDurationMs ?? 0}
                      peaks={[]}
                      tone="dark"
                      autoPlay
                      paused={storyPaused}
                    />
                  </div>
                )}
                {viewing.stories[storyIndex].meetup && (
                  <div className="mb-3 flex justify-center">
                    <MeetupCard
                      tone="dark"
                      title={viewing.stories[storyIndex].meetup!.title ?? ""}
                      startsAt={viewing.stories[storyIndex].meetup!.startsAt}
                      place={viewing.stories[storyIndex].meetup!.place}
                      attendees={viewing.stories[storyIndex].meetup!.attendees}
                      attendeeCount={viewing.stories[storyIndex].meetup!.attendeeCount}
                      isGoing={viewing.stories[storyIndex].meetup!.isGoing}
                      isCancelled={viewing.stories[storyIndex].meetup!.isCancelled}
                      busy={meetupBusy}
                      onToggle={() => void toggleMeetup(viewing.stories[storyIndex].meetup!.id)}
                      canManage={viewing.author.id === user?.id}
                      onEdit={() => setEditingMeetup({
                        id: viewing.stories[storyIndex].meetup!.id,
                        draft: meetupToDraft({
                          title: viewing.stories[storyIndex].meetup!.title ?? "",
                          startsAt: viewing.stories[storyIndex].meetup!.startsAt,
                          place: viewing.stories[storyIndex].meetup!.place,
                          note: "",
                        }),
                      })}
                      onCancel={() => setCancelMeetupId(viewing.stories[storyIndex].meetup!.id)}
                      reminderMinutes={user ? getLocalMeetupReminderMinutes(user.id, viewing.stories[storyIndex].meetup!.id) : null}
                      onReminderChange={(minutes) => void setStoryReminder(viewing.stories[storyIndex].meetup!.id, viewing.stories[storyIndex].meetup!.startsAt, minutes)}
                      key={`${viewing.stories[storyIndex].meetup!.id}:${reminderVersion}`}
                    />
                  </div>
                )}
                {viewing.stories[storyIndex].text && (
                  <p className="mb-3 text-center text-base font-semibold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                    {viewing.stories[storyIndex].text}
                  </p>
                )}
                {viewing.stories[storyIndex].reactionCounts.length > 0 && (
                  <div className="mb-2 flex gap-2 text-xs text-white/90">
                    {viewing.stories[storyIndex].reactionCounts.map((reaction) => (
                      <span key={reaction.emoji}>{reaction.emoji} {reaction.count}</span>
                    ))}
                  </div>
                )}
                <div className="mb-2 flex items-center justify-between">
                  {STORY_REACTIONS.map((emoji) => {
                    const selected = viewing.stories[storyIndex].myReaction === emoji;
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => void reactToStory(emoji)}
                        aria-label={`React ${emoji}`}
                        aria-pressed={selected}
                        className={`flex h-10 w-10 items-center justify-center rounded-full text-xl transition ${selected ? "bg-white/30 ring-2 ring-white" : "hover:bg-white/15"}`}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
                <form onSubmit={(event) => void replyToStory(event)} className="flex items-center gap-2">
                  <input
                    value={replyText}
                    onFocus={() => setReplyFocused(true)}
                    onBlur={() => setReplyFocused(false)}
                    onChange={(event) => setReplyText(event.target.value)}
                    placeholder={`Reply to @${viewing.author.username}...`}
                    maxLength={4000}
                    className="min-h-10 min-w-0 flex-1 rounded-full border border-white/40 bg-black/30 px-4 text-sm text-white placeholder:text-white/70 focus:border-white focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!replyText.trim() || replySending}
                    className="min-h-10 rounded-full bg-white px-4 text-xs font-semibold text-black disabled:opacity-50"
                  >
                    {replySending ? "..." : "Reply"}
                  </button>
                </form>
                {reactionError && <p role="alert" className="mt-2 text-xs text-white">{reactionError}</p>}
              </div>
            </div>
          </div>
        </div>, document.body
      )}
      {momentViewer && (
        <MomentViewer
          posts={momentViewer.posts}
          startId={momentViewer.startId}
          onClose={() => setMomentViewer(null)}
        />
      )}
      <StoryComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
      <MeetupSheet
        open={!!editingMeetup}
        onClose={() => setEditingMeetup(null)}
        onSubmit={updateStoryMeetup}
        initialDraft={editingMeetup?.draft}
        mode="edit"
      />
      <AppDialog
        open={!!cancelMeetupId}
        title="Cancel this meetup?"
        description="Everyone who said they’re going will be notified. The meetup will remain visible as cancelled until the story expires."
        confirmLabel="Cancel meetup"
        cancelLabel="Keep meetup"
        danger
        pending={meetupBusy}
        onClose={() => setCancelMeetupId(null)}
        onConfirm={() => void cancelStoryMeetup()}
      />
    </div>
  );
}
