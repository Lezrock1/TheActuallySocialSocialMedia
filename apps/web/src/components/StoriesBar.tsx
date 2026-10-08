import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import type { FormEvent } from "react";
import { STORY_REACTIONS } from "@app/shared";
import type { StoryGroup, StoryMeetup } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaUrl, preloadMediaKeys } from "../lib/upload.js";
import Avatar from "./Avatar.js";
import LiveRoomsBar from "./LiveRoomsBar.js";
import StoryComposer from "./StoryComposer.js";
import AudioPlayer from "./AudioPlayer.js";
import MeetupCard from "./chat/MeetupCard.js";
import MeetupSheet, { meetupToDraft } from "./MeetupFields.js";
import type { MeetupDraft } from "./MeetupFields.js";
import AppDialog from "./AppDialog.js";
import { useAuth } from "../auth/AuthContext.js";
import { clearLocalMeetupReminder, getLocalMeetupReminderMinutes, setLocalMeetupReminder } from "../lib/localMeetupReminders.js";

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

function StoryVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Browsers may refuse autoplay with sound; fall back to muted playback.
    video.play().catch(() => {
      video.muted = true;
      setMuted(true);
      void video.play().catch(() => undefined);
    });
  }, [src]);

  return (
    <>
      <video
        ref={ref}
        src={src}
        poster={poster}
        autoPlay
        loop
        playsInline
        muted={muted}
        preload="auto"
        className="h-full w-full object-contain"
      />
      <button
        type="button"
        onClick={() => setMuted((value) => !value)}
        aria-label={muted ? "Turn sound on" : "Turn sound off"}
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

export default function StoriesBar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [composerOpen, setComposerOpen] = useState(false);
  const [meetupBusy, setMeetupBusy] = useState(false);
  const [editingMeetup, setEditingMeetup] = useState<{ id: string; draft: MeetupDraft } | null>(null);
  const [cancelMeetupId, setCancelMeetupId] = useState<string | null>(null);
  const [reminderVersion, setReminderVersion] = useState(0);
  const [viewing, setViewing] = useState<StoryGroup | null>(null);
  const [storyIndex, setStoryIndex] = useState(0);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(getStoryLoadingPolicy);

  const { data: groups = [] } = useQuery({
    queryKey: ["stories"],
    queryFn: fetchStoryGroups,
  });

  const requestedStoryId = searchParams.get("story");
  useEffect(() => {
    if (!requestedStoryId) return;
    const group = groups.find((candidate) => candidate.stories.some((story) => story.id === requestedStoryId));
    if (!group) return;
    const index = group.stories.findIndex((story) => story.id === requestedStoryId);
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

  useEffect(() => {
    if (!viewing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setViewing(null);
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
        viewing.author.avatarKey
      );
    }

    preloadMediaKeys(keysToWarm, { priority: viewing ? "high" : "low" });
  }, [groups, loadingPolicy.preloadCount, storyIndex, viewing]);

  function advanceStory(direction: -1 | 1) {
    if (!viewing) return;
    const nextStoryIndex = storyIndex + direction;
    if (nextStoryIndex >= 0 && nextStoryIndex < viewing.stories.length) {
      setStoryIndex(nextStoryIndex);
      return;
    }

    const nextGroup = groups[viewingGroupIndex + direction];
    if (!nextGroup) {
      setViewing(null);
      return;
    }
    setViewing(nextGroup);
    setStoryIndex(direction > 0 ? 0 : nextGroup.stories.length - 1);
  }

  function openStoryGroup(group: StoryGroup) {
    setViewing(group);
    setStoryIndex(0);
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
            stories: current.stories.map((story, index) =>
              index === storyIndex ? { ...story, ...reaction } : story
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
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setViewing(null);
      navigate(`/dms?conversation=${result.conversationId}`, {
        state: {
          draftMessage: message,
          storyReply: {
            storyId: story.id,
            imageKey: story.imageKey,
            authorUsername: viewing.author.username,
            createdAt: story.createdAt,
          },
        },
      });
    } catch {
      setReactionError("Could not open a private reply.");
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
        {groups.map((group) => (
          <button
            key={group.author.id}
            onClick={() => openStoryGroup(group)}
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <span className="rounded-full bg-gradient-to-br from-gray-700 to-gray-900 p-0.5">
              <span className="block rounded-full border-2 border-white">
                <Avatar avatarKey={group.stories[0].imageKey} username={group.author.username} size={52} />
              </span>
            </span>
            <span className="max-w-[60px] truncate text-[11px] text-gray-600">@{group.author.username}</span>
          </button>
        ))}
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-3"
          role="dialog"
          aria-modal="true"
          aria-label={`Stories from @${viewing.author.username}`}
          onClick={() => setViewing(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-lg bg-black"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex gap-1 px-3 pt-3" aria-label={`Story ${storyIndex + 1} of ${viewing.stories.length}`}>
              {viewing.stories.map((story, index) => (
                <span key={story.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
                  {index <= storyIndex && <span className="block h-full bg-white" />}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between px-3 py-3 text-sm font-medium text-white">
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
            <div className="relative flex aspect-[9/16] max-h-[75vh] w-full items-center justify-center bg-gray-950">
              {viewing.stories[storyIndex].videoKey ? (
                <StoryVideo
                  key={viewing.stories[storyIndex].id}
                  src={mediaUrl(viewing.stories[storyIndex].videoKey!)}
                  poster={mediaUrl(viewing.stories[storyIndex].imageKey)}
                />
              ) : (
              <img
                src={mediaUrl(viewing.stories[storyIndex].imageKey)}
                alt={`Story ${storyIndex + 1} from @${viewing.author.username}`}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                className="h-full w-full object-contain"
              />
              )}
              <button
                type="button"
                onClick={() => advanceStory(-1)}
                aria-label="Previous story"
                className="absolute inset-y-0 left-0 w-1/2"
              />
              <button
                type="button"
                onClick={() => advanceStory(1)}
                aria-label="Next story"
                className="absolute inset-y-0 right-0 w-1/2"
              />
              <div
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
        </div>
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
