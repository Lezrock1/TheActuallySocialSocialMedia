import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { MAX_LIVE_ROOM_PARTICIPANTS } from "@app/shared";
import type {
  ConversationMessage,
  ConversationMessagesPage,
  ConversationSummary,
  PublicUser,
} from "@app/shared";
import type { EncryptedMessagePayload } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import {
  decryptMessage,
  encryptMessage,
  getDeviceEncryptionKeys,
} from "../lib/encryption.js";
import type { PublicEncryptionKey } from "../lib/encryption.js";
import { registerDeviceEncryptionKey } from "../lib/encryptionRegistration.js";
import { useWebRtcCall } from "../lib/useWebRtcCall.js";
import { getSocket } from "../lib/socket.js";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import { useConversationBackground } from "../lib/pageBackground.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import Avatar from "../components/Avatar.js";
import CallOverlay from "../components/CallOverlay.js";
import EncryptionNotice from "../components/EncryptionNotice.js";
import LiveRoomsBar from "../components/LiveRoomsBar.js";
import PullToRefresh from "../components/PullToRefresh.js";
import {
  activityList,
  activityRow,
  card,
  formatActivityTime,
  input,
  btnPrimary,
  btnSecondary,
} from "../lib/ui.js";
import { InlineSkeletonText } from "../components/LoadingSkeleton.js";
import MeetupCard from "../components/chat/MeetupCard.js";
import VoiceMessage from "../components/chat/VoiceMessage.js";
import MeetupSheet, { meetupToDraft } from "../components/MeetupFields.js";
import type { MeetupDraft } from "../components/MeetupFields.js";
import AppDialog from "../components/AppDialog.js";
import SecurityCodeSheet from "../components/SecurityCodeSheet.js";
import { overallStatus, usePeerSafety } from "../lib/safety.js";
import {
  buildMeetupCancelContent,
  buildMeetupContent,
  buildMeetupUpdateContent,
  buildRsvpContent,
  buildVoiceContent,
  computeMeetupAttendance,
  computeMeetupStates,
  parseMessageContent,
} from "../lib/messageContent.js";
import type { MeetupContent, StoryReplyContext } from "../lib/messageContent.js";
import { clearLocalMeetupReminder, getLocalMeetupReminderMinutes, setLocalMeetupReminder, syncLocalChatMeetupReminders } from "../lib/localMeetupReminders.js";
import { computePeaks, encryptAudioBlob } from "../lib/voice.js";
import { formatDuration, isAudioRecordingSupported, useAudioRecorder } from "../lib/useAudioRecorder.js";
import type { AudioRecording } from "../lib/useAudioRecorder.js";
import { MAX_VOICE_MESSAGE_MS } from "@app/shared";

const MESSAGE_PAGE_LIMIT = 40;

async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await apiFetch<{ conversations: ConversationSummary[] }>(
    "/conversations"
  );
  return res.conversations;
}

async function fetchFollowing(username: string): Promise<PublicUser[]> {
  const res = await apiFetch<{ users: PublicUser[] }>(`/users/${username}/following`);
  return res.users;
}

async function fetchMessagesPage(
  id: string,
  cursor: string | null
): Promise<ConversationMessagesPage> {
  const params = new URLSearchParams();
  params.set("limit", String(MESSAGE_PAGE_LIMIT));
  if (cursor) params.set("cursor", cursor);
  const res = await apiFetch<ConversationMessagesPage>(
    `/conversations/${id}/messages?${params.toString()}`
  );
  return res;
}

async function markConversationRead(id: string): Promise<void> {
  await apiFetch(`/conversations/${id}/read`, { method: "POST" });
}

async function fetchEncryptionKeys(id: string): Promise<PublicEncryptionKey[]> {
  const res = await apiFetch<{ keys: PublicEncryptionKey[] }>(
    `/conversations/${id}/encryption-keys`
  );
  return res.keys;
}

export default function DMsPage() {
  const { user } = useAuth();
  const conversationBackgroundStyle = useConversationBackground();
  const queryClient = useQueryClient();
  const call = useWebRtcCall(user?.id);
  const friendPickerRef = useRef<HTMLDivElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const scrolledConversationRef = useRef<string | null>(null);
  const prependScrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const lastVisibleMessageIdRef = useRef<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get("conversation"));
  const [friendSearch, setFriendSearch] = useState("");
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [selectedGroupUsernames, setSelectedGroupUsernames] = useState<string[]>([]);
  const [startingConversation, setStartingConversation] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [storyReplyContext, setStoryReplyContext] = useState<StoryReplyContext | null>(null);
  const [messageView, setMessageView] = useState<"chats" | "create_group" | "live_rooms">(() =>
    searchParams.get("view") === "live_rooms" ? "live_rooms" : "chats"
  );
  const groupMode = messageView === "create_group";
  const [groupName, setGroupName] = useState("");
  const [deviceKeyReady, setDeviceKeyReady] = useState(false);
  const [encryptionError, setEncryptionError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [decryptedMessages, setDecryptedMessages] = useState<Record<string, string>>({});
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [meetupOpen, setMeetupOpen] = useState(false);
  const [editingMeetup, setEditingMeetup] = useState<MeetupContent | null>(null);
  const [cancelMeetupId, setCancelMeetupId] = useState<string | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [safetyVersion, setSafetyVersion] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [rsvpBusy, setRsvpBusy] = useState<string | null>(null);
  const recorder = useAudioRecorder({ maxMs: MAX_VOICE_MESSAGE_MS, onFinished: (recording) => void sendVoice(recording) });

  useEffect(() => {
    if (searchParams.get("view") !== "live_rooms") return;
    setActiveId(null);
    setMessageView("live_rooms");
  }, [searchParams]);

  useEffect(() => {
    const state = location.state as {
      draftMessage?: unknown;
      storyReply?: Partial<StoryReplyContext>;
    } | null;
    if (typeof state?.draftMessage !== "string" || !state.draftMessage) return;
    setMessageText(state.draftMessage);
    if (
      typeof state.storyReply?.storyId === "string" &&
      typeof state.storyReply.imageKey === "string" &&
      typeof state.storyReply.authorUsername === "string" &&
      typeof state.storyReply.createdAt === "string"
    ) {
      setStoryReplyContext({
        storyId: state.storyReply.storyId,
        imageKey: state.storyReply.imageKey,
        authorUsername: state.storyReply.authorUsername,
        createdAt: state.storyReply.createdAt,
      });
    }
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.key, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateOffset = () => {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOffset(offset);
    };

    updateOffset();
    viewport.addEventListener("resize", updateOffset);
    viewport.addEventListener("scroll", updateOffset);
    window.addEventListener("orientationchange", updateOffset);
    return () => {
      viewport.removeEventListener("resize", updateOffset);
      viewport.removeEventListener("scroll", updateOffset);
      window.removeEventListener("orientationchange", updateOffset);
    };
  }, []);

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
  });
  const { data: followedUsers = [], isLoading: friendsLoading } = useQuery({
    queryKey: ["following", user?.username],
    queryFn: () => fetchFollowing(user!.username),
    enabled: !!user,
    staleTime: 30_000,
  });
  const normalizedFriendSearch = friendSearch.trim().replace(/^@/, "").toLocaleLowerCase();
  const matchingFriends = followedUsers
    .filter((friend) => !normalizedFriendSearch ||
      friend.username.toLocaleLowerCase().includes(normalizedFriendSearch) ||
      friend.displayName?.toLocaleLowerCase().includes(normalizedFriendSearch))
    .sort((a, b) => {
      if (!normalizedFriendSearch) return (a.displayName ?? a.username).localeCompare(b.displayName ?? b.username);
      const aName = `${a.displayName ?? ""} ${a.username}`.toLocaleLowerCase();
      const bName = `${b.displayName ?? ""} ${b.username}`.toLocaleLowerCase();
      return Number(!aName.startsWith(normalizedFriendSearch)) - Number(!bName.startsWith(normalizedFriendSearch));
    });

  const messagesQuery = useInfiniteQuery({
    queryKey: ["messages", activeId],
    queryFn: ({ pageParam }) => fetchMessagesPage(activeId!, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!activeId,
  });
  const messagePages = messagesQuery.data?.pages ?? [];
  const messages = [...messagePages].reverse().flatMap((page) => page.messages);
  const messagesLoaded = messagesQuery.isSuccess;
  const newestMessageId = messages[messages.length - 1]?.id ?? null;

  useLayoutEffect(() => {
    if (!activeId || !messagesLoaded || !messageScrollRef.current) return;
    const container = messageScrollRef.current;

    if (scrolledConversationRef.current !== activeId) {
      container.scrollTop = container.scrollHeight;
      scrolledConversationRef.current = activeId;
      lastVisibleMessageIdRef.current = newestMessageId;
      return;
    }

    if (prependScrollAnchorRef.current) {
      const { scrollHeight, scrollTop } = prependScrollAnchorRef.current;
      const delta = container.scrollHeight - scrollHeight;
      container.scrollTop = scrollTop + delta;
      prependScrollAnchorRef.current = null;
      lastVisibleMessageIdRef.current = newestMessageId;
      return;
    }

    if (newestMessageId && newestMessageId !== lastVisibleMessageIdRef.current) {
      const nearBottom = container.scrollHeight - (container.scrollTop + container.clientHeight) <= 120;
      if (nearBottom) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
      lastVisibleMessageIdRef.current = newestMessageId;
    }
  }, [activeId, messagesLoaded, newestMessageId]);
  const { data: encryptionKeys = [], isError: encryptionKeysError } = useQuery({
    queryKey: ["conversation-encryption-keys", activeId],
    queryFn: () => fetchEncryptionKeys(activeId!),
    enabled: !!activeId && deviceKeyReady,
  });
  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const callConversationId = call.activeCall?.conversationId ?? call.incomingCall?.conversationId;
  const callConversation = conversations.find((conversation) => conversation.id === callConversationId);
  const canCall = !!activeConversation && activeConversation.members.length >= 2 && activeConversation.members.length <= MAX_LIVE_ROOM_PARTICIPANTS;
  const membersWithKeys = new Set(encryptionKeys.map((key) => key.userId));
  const allMembersHaveKeys = !!activeConversation &&
    activeConversation.members.length > 0 &&
    activeConversation.members.every((member) => membersWithKeys.has(member.id));
  const parsedMessages = messages.map((message) => ({
    message,
    parsed: parseMessageContent(message.isEncrypted ? decryptedMessages[message.id] ?? "" : message.text ?? ""),
    decrypting: message.isEncrypted && decryptedMessages[message.id] === undefined,
  }));
  const attendance = computeMeetupAttendance(
    parsedMessages.map(({ message, parsed }) => ({ senderId: message.senderId, parsed }))
  );
  const meetupStates = computeMeetupStates(
    parsedMessages.map(({ message, parsed }) => ({ id: message.id, senderId: message.senderId, parsed }))
  );
  const [reminderVersion, setReminderVersion] = useState(0);
  useEffect(() => {
    if (!user || !activeId || !messagesLoaded) return;
    const reminderStates = new Map([...meetupStates].map(([id, state]) => [
      id,
      { startsAt: state.meetup.startsAt, status: state.status },
    ]));
    if (syncLocalChatMeetupReminders(user.id, activeId, reminderStates)) {
      setReminderVersion((version) => version + 1);
    }
  }, [activeId, decryptedMessages, messagesLoaded, newestMessageId, user]);
  const peers = (activeConversation?.members ?? []).filter((member) => member.id !== user?.id);
  const peerSafety = usePeerSafety(user?.id, peers.map((peer) => peer.id), encryptionKeys, safetyVersion);
  const securityStatus = overallStatus(peers.map((peer) => peerSafety[peer.id] ?? { safetyNumber: null, status: "unavailable" }));

  useEffect(() => {
    if (!activeId || !messagesLoaded) return;
    void markConversationRead(activeId)
      .then(() => Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }),
      ]))
      .catch(() => undefined);
  }, [activeId, messagesLoaded, queryClient]);

  useEffect(() => {
    const socket = getSocket();
    function onNewMessage(payload: {
      conversationId: string;
      message: ConversationMessage;
    }) {
      queryClient.setQueryData<InfiniteData<ConversationMessagesPage>>(
        ["messages", payload.conversationId],
        (current) => {
          if (!current || current.pages.length === 0) return current;
          const [latestPage, ...olderPages] = current.pages;
          if (latestPage.messages.some((message) => message.id === payload.message.id)) {
            return current;
          }
          return {
            ...current,
            pages: [
              {
                ...latestPage,
                messages: [...latestPage.messages, payload.message],
              },
              ...olderPages,
            ],
          };
        }
      );
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (payload.conversationId === activeId && document.visibilityState === "visible") {
        void markConversationRead(payload.conversationId)
          .then(() => Promise.all([
            queryClient.invalidateQueries({ queryKey: ["conversations"] }),
            queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
            queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }),
          ]))
          .catch(() => undefined);
      }
    }
    socket.on("message:new", onNewMessage);
    return () => {
      socket.off("message:new", onNewMessage);
    };
  }, [activeId, queryClient]);

  useEffect(() => {
    if (!friendPickerOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !friendPickerRef.current?.contains(event.target)) {
        setFriendPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [friendPickerOpen]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setDeviceKeyReady(false);
    setEncryptionError(null);
    void (async () => {
      try {
        await registerDeviceEncryptionKey(user.id);
        if (!cancelled) setDeviceKeyReady(true);
      } catch (error) {
        if (!cancelled) {
          setEncryptionError(error instanceof Error ? error.message : "Could not set up encryption");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || messages.length === 0) return;
    let cancelled = false;
    void (async () => {
      const localKeys = await getDeviceEncryptionKeys(user.id);
      const decrypted = await Promise.all(messages.map(async (message) => {
        if (!message.isEncrypted || !message.encryptedPayload) return null;
        try {
          return [message.id, await decryptMessage(message.encryptedPayload, localKeys)] as const;
        } catch {
          return [message.id, "Unable to decrypt on this device."] as const;
        }
      }));
      if (!cancelled) {
        setDecryptedMessages((current) => ({
          ...current,
          ...Object.fromEntries(decrypted.filter((item): item is NonNullable<typeof item> => item !== null)),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, user]);

  function loadOlderMessages() {
    if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage || !messageScrollRef.current) return;
    const container = messageScrollRef.current;
    prependScrollAnchorRef.current = {
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
    void messagesQuery.fetchNextPage();
  }

  async function startConversation(username: string) {
    setStartingConversation(true);
    try {
      const res = await apiFetch<{ conversationId: string }>("/conversations", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setFriendSearch("");
      setFriendPickerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setActiveId(res.conversationId);
    } finally {
      setStartingConversation(false);
    }
  }

  async function startGroup() {
    if (selectedGroupUsernames.length === 0) return;
    const res = await apiFetch<{ conversationId: string }>("/conversations/group", {
      method: "POST",
      body: JSON.stringify({ name: groupName || undefined, usernames: selectedGroupUsernames }),
    });
    setGroupName("");
    setSelectedGroupUsernames([]);
    setFriendSearch("");
    setFriendPickerOpen(false);
    setMessageView("chats");
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    setActiveId(res.conversationId);
  }

  function chooseFriend(friend: PublicUser) {
    if (!groupMode) {
      void startConversation(friend.username);
      return;
    }
    setSelectedGroupUsernames((current) => current.includes(friend.username)
      ? current.filter((username) => username !== friend.username)
      : [...current, friend.username]);
  }

  async function sendEncrypted(content: string, mediaKey?: string) {
    if (!activeId || !deviceKeyReady) throw new Error("Encryption is not ready yet.");
    if (!allMembersHaveKeys) {
      throw new Error("Every participant must open Messages once before you can send an encrypted message.");
    }
    const encryptedPayload: EncryptedMessagePayload = await encryptMessage(content, encryptionKeys);
    await apiFetch(`/conversations/${activeId}/messages`, {
      method: "POST",
      body: JSON.stringify({ encryptedPayload, ...(mediaKey ? { mediaKey } : {}) }),
    });
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!messageText.trim() || !activeId || !deviceKeyReady) return;
    setMessageError(null);
    try {
      const messageContent = storyReplyContext
        ? JSON.stringify({
            type: "story_reply",
            story: storyReplyContext,
            text: messageText.trim(),
          })
        : messageText.trim();
      await sendEncrypted(messageContent);
      setMessageText("");
      setStoryReplyContext(null);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Could not encrypt this message");
    }
  }

  async function sendVoice(recording: AudioRecording) {
    if (recording.durationMs < 700) return;
    setMessageError(null);
    setVoiceBusy(true);
    try {
      const [encrypted, peaks] = await Promise.all([encryptAudioBlob(recording.blob), computePeaks(recording.blob)]);
      const mediaKey = await uploadMedia(encrypted.file, { resize: false });
      await sendEncrypted(buildVoiceContent({
        mediaKey,
        key: encrypted.key,
        iv: encrypted.iv,
        durationMs: recording.durationMs,
        peaks,
      }), mediaKey);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Could not send the voice message.");
    } finally {
      setVoiceBusy(false);
    }
  }

  async function sendMeetup(draft: MeetupDraft) {
    await sendEncrypted(buildMeetupContent({
      id: crypto.randomUUID(),
      title: draft.title.trim(),
      startsAt: new Date(draft.when).toISOString(),
      place: draft.place.trim(),
      note: draft.note.trim(),
    }));
  }

  async function updateMeetup(draft: MeetupDraft) {
    if (!editingMeetup) return;
    await sendEncrypted(buildMeetupUpdateContent({
      id: editingMeetup.id,
      title: draft.title.trim(),
      startsAt: new Date(draft.when).toISOString(),
      place: draft.place.trim(),
      note: draft.note.trim(),
    }));
    setEditingMeetup(null);
  }

  async function cancelMeetup(meetupId: string) {
    try {
      await sendEncrypted(buildMeetupCancelContent(meetupId));
      if (user) clearLocalMeetupReminder(user.id, meetupId);
      setReminderVersion((version) => version + 1);
      setMessageError(null);
      return true;
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Could not cancel this meetup.");
      return false;
    }
  }

  async function setMeetupReminder(meetupId: string, startsAt: string, minutes: number | null) {
    if (!user || !activeId) return;
    const error = await setLocalMeetupReminder(
      user.id,
      meetupId,
      startsAt,
      minutes,
      `/dms?conversation=${encodeURIComponent(activeId)}`,
      undefined,
      activeId
    );
    if (error) setMessageError(error);
    else {
      setMessageError(null);
      setReminderVersion((version) => version + 1);
    }
  }

  async function toggleRsvp(meetupId: string, going: boolean) {
    setRsvpBusy(meetupId);
    setMessageError(null);
    try {
      await sendEncrypted(buildRsvpContent(meetupId, going));
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Could not update your answer.");
    } finally {
      setRsvpBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PullToRefresh enabled={!call.activeCall && !call.incomingCall} onRefresh={async () => {
        const refreshes = [
          queryClient.invalidateQueries({ queryKey: ["conversations"] }),
          queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
        ];
        if (activeId) refreshes.push(queryClient.invalidateQueries({ queryKey: ["messages", activeId] }));
        await Promise.all(refreshes);
      }} />
      <PageHeader title="Messages" />
      <NavBar />
      {encryptionError && <p role="alert" className="mb-3 text-xs text-red-600">{encryptionError}</p>}

      <div className="flex flex-col gap-6">
        {!activeId && <div className="w-full">
          <div role="tablist" aria-label="Messages view" className="mb-3 inline-flex max-w-full rounded-lg bg-gray-100 p-1">
            <button
              type="button"
              role="tab"
              aria-selected={messageView === "chats"}
              onClick={() => {
                setMessageView("chats");
                setSelectedGroupUsernames([]);
              }}
              className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${messageView === "chats" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              Chats
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={messageView === "create_group"}
              onClick={() => setMessageView("create_group")}
              className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${messageView === "create_group" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              Create a Group
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={messageView === "live_rooms"}
              onClick={() => setMessageView("live_rooms")}
              className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${messageView === "live_rooms" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              Live Rooms
            </button>
          </div>
          {messageView !== "live_rooms" && <form
            onSubmit={(event) => {
              event.preventDefault();
              if (groupMode) void startGroup();
              else if (matchingFriends[0]) void startConversation(matchingFriends[0].username);
            }}
            className={`${card} mb-4 flex flex-col gap-3`}
          >
            {groupMode && (
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name (optional)"
                className={input}
              />
            )}
            <div ref={friendPickerRef} className="relative">
              <input
                value={friendSearch}
                onFocus={() => setFriendPickerOpen(true)}
                onChange={(e) => {
                  setFriendSearch(e.target.value);
                  setFriendPickerOpen(true);
                }}
                placeholder={groupMode ? "Search friends to add" : "Search friends by name or @username"}
                className={`${input} w-full`}
                role="combobox"
                aria-expanded={friendPickerOpen}
                aria-controls="message-friend-results"
                aria-autocomplete="list"
              />
              {friendPickerOpen && (
                <div
                  id="message-friend-results"
                  role="listbox"
                  aria-label={normalizedFriendSearch ? "Matching followed accounts" : "Followed accounts"}
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                >
                  {friendsLoading ? (
                    <div aria-hidden="true" className="space-y-2 px-3 py-3">
                      <InlineSkeletonText width="w-32" />
                      <InlineSkeletonText width="w-44" />
                      <InlineSkeletonText width="w-28" />
                    </div>
                  ) : matchingFriends.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-gray-500">
                      {followedUsers.length ? "No followed accounts match that name." : "Follow someone first to message them."}
                    </p>
                  ) : matchingFriends.map((friend) => {
                    const selected = selectedGroupUsernames.includes(friend.username);
                    return (
                      <button
                        key={friend.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => chooseFriend(friend)}
                        disabled={startingConversation}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none disabled:opacity-60"
                      >
                        <Avatar avatarKey={friend.avatarKey} username={friend.username} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900">
                            {friend.displayName || `@${friend.username}`}
                          </span>
                          {friend.displayName && <span className="block truncate text-xs text-gray-500">@{friend.username}</span>}
                        </span>
                        {groupMode && <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${selected ? "border-black bg-black text-white" : "border-gray-300 text-transparent"}`}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {groupMode && selectedGroupUsernames.length > 0 && (
              <p className="text-xs text-gray-500">
                Selected: {selectedGroupUsernames.map((username) => `@${username}`).join(", ")}
              </p>
            )}
            {groupMode && (
              <button disabled={!selectedGroupUsernames.length} className={btnSecondary}>
                Create a Group
              </button>
            )}
            {!groupMode && friendSearch.trim() && matchingFriends.length > 0 && (
              <button type="submit" disabled={startingConversation} className={`${btnSecondary} self-start`}>
                {startingConversation ? "Opening..." : `Message @${matchingFriends[0].username}`}
              </button>
            )}
          </form>}
          {messageView === "chats" && <div className={activityList}>
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={activityRow}
              >
                {c.isGroup ? (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
                    {c.members.length}
                  </span>
                ) : (
                  <Avatar
                    avatarKey={c.otherMember?.avatarKey ?? null}
                    username={c.otherMember?.username ?? "?"}
                    size={44}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
                      {c.isGroup
                        ? c.name ?? c.members.map((member) => `@${member.username}`).join(", ")
                        : `@${c.otherMember?.username ?? "Unknown"}`}
                    </span>
                    {c.lastMessage && (
                      <time className="shrink-0 text-[11px] text-gray-400">
                        {formatActivityTime(c.lastMessage.createdAt)}
                      </time>
                    )}
                    {c.unreadCount > 0 && (
                      <span
                        aria-label={`${c.unreadCount} unread messages`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700"
                      >
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-green-600" />
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </span>
                  {c.lastMessage && (
                    <span className="mt-0.5 block">
                      <span className="block truncate text-xs leading-5 text-gray-500">
                        {c.lastMessage.isEncrypted ? "Encrypted message" : c.lastMessage.text}
                      </span>
                      <EncryptionNotice encrypted={c.lastMessage.isEncrypted}>
                        {c.lastMessage.isEncrypted ? "End-to-end encrypted" : "Not end-to-end encrypted"}
                      </EncryptionNotice>
                    </span>
                  )}
                  {!c.lastMessage && <span className="mt-0.5 block text-xs text-gray-400">No messages yet</span>}
                </span>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-500">No conversations yet.</p>
            )}
          </div>}
          {messageView === "chats" && (
            <div className="mt-4 border-t border-gray-100 pt-3 text-[11px] leading-5 text-gray-500">
              <p>{deviceKeyReady ? "This device is ready for encrypted messages." : "Preparing encrypted messaging for this device."}</p>
              <p>Device keys stay in this browser; clearing its data can make encrypted history unreadable.</p>
            </div>
          )}
          {messageView === "live_rooms" && <LiveRoomsBar />}
        </div>}

        {activeId && (
          <section className="w-full" aria-label="Conversation">
            <div className="mb-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setActiveId(null);
                  setSearchParams({});
                }}
                className="min-h-10 shrink-0 px-1 text-sm font-medium text-gray-600 hover:text-black"
              >
                ← Messages
              </button>
              <h2 className="min-w-0 truncate text-sm font-semibold">
                {activeConversation?.isGroup
                  ? activeConversation.name ?? activeConversation.members.map((member) => `@${member.username}`).join(", ")
                  : `@${activeConversation?.otherMember?.username ?? "Conversation"}`}
              </h2>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSecurityOpen(true)}
                  aria-label="Security code"
                  title={securityStatus === "verified" ? "Security code verified" : securityStatus === "changed" ? "Security code changed" : "Verify security code"}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-full border hover:bg-gray-50 ${securityStatus === "changed" ? "border-amber-300 text-amber-700" : securityStatus === "verified" ? "border-green-300 text-green-700" : "border-gray-200 text-gray-600"}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V6l-7-3Z" />
                    {securityStatus === "verified" && <path d="m9 12 2.2 2.2L15.5 10" />}
                    {securityStatus === "changed" && <path d="M12 8.5v4M12 15.5h.01" />}
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => activeId && void call.startCall(activeId, "audio")}
                  disabled={!canCall || !!call.activeCall || !!call.incomingCall}
                  aria-label="Start audio call"
                  title="Audio call"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.6 3.5h3l1.5 4.2-2 1.5a14 14 0 0 0 5.7 5.7l1.5-2 4.2 1.5v3a1.6 1.6 0 0 1-1.8 1.6A16.7 16.7 0 0 1 4.9 5.3 1.6 1.6 0 0 1 6.6 3.5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => activeId && void call.startCall(activeId, "video")}
                  disabled={!canCall || !!call.activeCall || !!call.incomingCall}
                  aria-label="Start video call"
                  title="Video call"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="6" width="12" height="12" rx="2" />
                    <path d="m15 10 6-3v10l-6-3" />
                  </svg>
                </button>
              </div>
            </div>
            <EncryptionNotice encrypted={deviceKeyReady && allMembersHaveKeys && !encryptionKeysError}>
              {deviceKeyReady && allMembersHaveKeys && !encryptionKeysError
                ? "End-to-end encryption is ready for this conversation."
                : "This conversation is not ready for end-to-end encryption."}
            </EncryptionNotice>
            <details className="mb-3 mt-1 text-[11px] text-gray-600">
              <summary className="cursor-pointer">Key verification and device limits</summary>
              <p className="mt-1">
                Tap the shield above to compare a short security code with each participant. The server distributes public keys, so without that check a malicious server could substitute a key.
                Keys are stored only in this browser, and newly added devices cannot read earlier messages.
              </p>
              {encryptionKeys.map((key) => (
                <p key={key.fingerprint} className="mt-1 break-all font-mono">
                  {activeConversation?.members.find((member) => member.id === key.userId)?.username ?? "Device"}: {key.fingerprint}
                </p>
              ))}
            </details>
            {encryptionKeysError && (
              <p role="alert" className="mb-2 text-xs text-red-600">Could not load conversation encryption keys.</p>
            )}
            <div ref={messageScrollRef} style={conversationBackgroundStyle} className={`${card} mb-3 flex max-h-[55vh] min-h-40 flex-col gap-2 overflow-y-auto`}>
              {messagesQuery.hasNextPage && (
                <div className="self-center pb-1 pt-0.5">
                  <button
                    type="button"
                    onClick={loadOlderMessages}
                    disabled={messagesQuery.isFetchingNextPage}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {messagesQuery.isFetchingNextPage ? "Loading older messages..." : "Load older messages"}
                  </button>
                </div>
              )}
              {parsedMessages.map(({ message, parsed, decrypting }) => {
                if (parsed.kind === "rsvp" || parsed.kind === "meetup_cancel") return null;
                const mine = message.senderId === user?.id;
                const sender = activeConversation?.members.find((member) => member.id === message.senderId);

                if (parsed.kind === "meetup") {
                  const state = meetupStates.get(parsed.meetup.id);
                  if (parsed.event === "updated" && state?.sourceMessageId !== message.id) return null;
                  if (state && state.sourceMessageId !== message.id) return null;
                  const meetup = state?.meetup ?? parsed.meetup;
                  const goingIds = attendance.get(parsed.meetup.id)?.goingUserIds ?? [];
                  const goingMembers = (activeConversation?.members ?? []).filter((member) => goingIds.includes(member.id));
                  const isGoing = !!user && goingIds.includes(user.id);
                  const isCancelled = state?.status === "cancelled";
                  const canManage = state?.proposerId === user?.id;
                  return (
                    <div key={message.id} className={`flex max-w-[92%] flex-col gap-1 ${mine ? "self-end items-end" : "self-start items-start"}`}>
                      <span className="px-1 text-[11px] text-gray-500">
                        {isCancelled
                          ? "Meetup cancelled"
                          : state?.updated
                            ? "Meetup updated"
                            : `${mine ? "You" : `@${sender?.username ?? "someone"}`} proposed a meetup`}
                      </span>
                      <MeetupCard
                        title={meetup.title}
                        startsAt={meetup.startsAt}
                        place={meetup.place}
                        note={meetup.note}
                        attendees={goingMembers}
                        attendeeCount={goingMembers.length}
                        isGoing={isGoing}
                        isCancelled={isCancelled}
                        busy={rsvpBusy === parsed.meetup.id}
                        onToggle={() => void toggleRsvp(parsed.meetup.id, !isGoing)}
                        canManage={canManage}
                        onEdit={() => setEditingMeetup(meetup)}
                        onCancel={() => setCancelMeetupId(parsed.meetup.id)}
                        reminderMinutes={user ? getLocalMeetupReminderMinutes(user.id, parsed.meetup.id) : null}
                        onReminderChange={(minutes) => void setMeetupReminder(parsed.meetup.id, meetup.startsAt, minutes)}
                        key={`${message.id}:${reminderVersion}`}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={message.id}
                    className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${
                      mine
                        ? "self-end bg-black text-white"
                        : "self-start bg-gray-100"
                    }`}
                  >
                    {parsed.kind === "text" && parsed.storyReply && (
                      <div
                        data-story-id={parsed.storyReply.storyId}
                        className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg bg-black/5 p-1.5"
                      >
                        <img
                          src={mediaUrl(parsed.storyReply.imageKey)}
                          alt={`Story by @${parsed.storyReply.authorUsername}`}
                          loading="lazy"
                          decoding="async"
                          className="h-14 w-10 shrink-0 rounded object-cover"
                        />
                        <span className="min-w-0 py-1">
                          <span className="block text-[11px] font-semibold">Story reply</span>
                          <span className="block truncate text-xs opacity-80">
                            @{parsed.storyReply.authorUsername}
                            {parsed.storyReply.createdAt && ` · ${formatActivityTime(parsed.storyReply.createdAt)}`}
                          </span>
                        </span>
                      </div>
                    )}
                    {parsed.kind === "voice" ? (
                      <VoiceMessage voice={parsed.voice} tone={mine ? "dark" : "light"} />
                    ) : (
                      <p className="whitespace-pre-wrap">{decrypting ? "Decrypting message..." : parsed.text}</p>
                    )}
                    <EncryptionNotice encrypted={message.isEncrypted}>
                      {message.isEncrypted ? "End-to-end encrypted" : "Not end-to-end encrypted"}
                    </EncryptionNotice>
                  </div>
                );
              })}
              {messages.length === 0 && (
                <p className="text-xs text-gray-400">No messages yet.</p>
              )}
            </div>
            {messageError && <p role="alert" className="mb-2 text-xs text-red-600">{messageError}</p>}
            {storyReplyContext && (
              <div className="mb-2 flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
                <img
                  src={mediaUrl(storyReplyContext.imageKey)}
                  alt={`Story by @${storyReplyContext.authorUsername}`}
                  loading="lazy"
                  decoding="async"
                  className="h-14 w-10 shrink-0 rounded object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-gray-800">Replying to story</span>
                  <span className="block truncate text-xs text-gray-500">
                    @{storyReplyContext.authorUsername} · {formatActivityTime(storyReplyContext.createdAt)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setStoryReplyContext(null)}
                  aria-label="Remove Story reply context"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-gray-500 hover:bg-gray-200"
                >
                  ×
                </button>
              </div>
            )}
            <div
              className="sticky bottom-0 z-20 -mx-1 rounded-xl bg-white/90 px-1 pt-2 backdrop-blur"
              style={{
                paddingBottom: "max(0.35rem, env(safe-area-inset-bottom))",
                transform: keyboardOffset > 0 ? `translateY(-${keyboardOffset}px)` : undefined,
              }}
            >
              {recorder.recording ? (
                <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2">
                  <span className="record-pulse h-3 w-3 shrink-0 rounded-full bg-red-500" />
                  <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-red-700">
                    {formatDuration(recorder.elapsedMs)}
                  </span>
                  <span className="flex h-7 min-w-0 flex-1 items-center gap-[2px]" aria-hidden="true">
                    {Array.from({ length: 28 }, (_, index) => (
                      <span
                        key={index}
                        style={{ height: `${Math.max(14, Math.min(100, recorder.level * 100 * (0.45 + ((index * 7) % 6) / 7)))}%` }}
                        className="w-[3px] flex-1 rounded-full bg-red-400 transition-[height] duration-100"
                      />
                    ))}
                  </span>
                  <button
                    type="button"
                    onClick={recorder.cancel}
                    aria-label="Discard recording"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-red-600 hover:bg-red-100"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={recorder.stop}
                    aria-label="Send voice message"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-700 text-white hover:bg-green-800 active:scale-95"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => void sendMessage(e)} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMeetupOpen(true)}
                    disabled={!deviceKeyReady || !allMembersHaveKeys}
                    aria-label="Propose a meetup"
                    title="Propose a meetup"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3.5" y="5" width="17" height="15" rx="3" />
                      <path d="M8 3v4M16 3v4M3.5 10h17M12 13v4M10 15h4" />
                    </svg>
                  </button>
                  <input
                    ref={composerInputRef}
                    value={messageText}
                    onFocus={() => {
                      window.setTimeout(() => {
                        messageScrollRef.current?.scrollTo({
                          top: messageScrollRef.current.scrollHeight,
                          behavior: "smooth",
                        });
                      }, 60);
                    }}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder={voiceBusy ? "Sending voice message..." : "Message..."}
                    className={`${input} min-w-0 flex-1`}
                  />
                  {messageText.trim() || voiceBusy ? (
                    <button
                      disabled={!deviceKeyReady || !allMembersHaveKeys || voiceBusy}
                      className={`${btnPrimary} min-h-10 shrink-0 bg-green-700 hover:bg-green-800 focus-visible:ring-green-700/20 disabled:opacity-50`}
                    >Send</button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void recorder.start()}
                      disabled={!deviceKeyReady || !allMembersHaveKeys}
                      aria-label="Record a voice message"
                      title="Voice message"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-700 text-white transition-transform hover:bg-green-800 active:scale-95 disabled:opacity-50"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="3" width="6" height="12" rx="3" />
                        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                      </svg>
                    </button>
                  )}
                </form>
              )}
              {recorder.error && (
                <div role="alert" className="mt-1 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span className="min-w-0 flex-1">{recorder.error}</span>
                  <button type="button" onClick={() => void recorder.start()} className="shrink-0 font-semibold underline">Try again</button>
                </div>
              )}
              {!isAudioRecordingSupported() && (
                <p className="mt-1 text-[11px] leading-4 text-gray-500">
                  Voice recording is unavailable in this browser; encrypted text messages still work.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
      <MeetupSheet open={meetupOpen} onClose={() => setMeetupOpen(false)} onSubmit={sendMeetup} />
      <MeetupSheet
        open={!!editingMeetup}
        onClose={() => setEditingMeetup(null)}
        onSubmit={updateMeetup}
        initialDraft={editingMeetup ? {
          ...meetupToDraft(editingMeetup),
        } : undefined}
        mode="edit"
      />
      <AppDialog
        open={!!cancelMeetupId}
        title="Cancel this meetup?"
        description="This cancellation is shared as an end-to-end encrypted message. Everyone in the chat will see it."
        confirmLabel="Cancel meetup"
        cancelLabel="Keep meetup"
        danger
        pending={!!cancelMeetupId && rsvpBusy === cancelMeetupId}
        onClose={() => setCancelMeetupId(null)}
        onConfirm={() => {
          if (!cancelMeetupId) return;
          const meetupId = cancelMeetupId;
          setRsvpBusy(meetupId);
          void cancelMeetup(meetupId)
            .then((cancelled) => { if (cancelled) setCancelMeetupId(null); })
            .finally(() => setRsvpBusy(null));
        }}
      />
      {user && peers.length > 0 && (
        <SecurityCodeSheet
          open={securityOpen}
          onClose={() => setSecurityOpen(false)}
          meId={user.id}
          peers={peers}
          keys={encryptionKeys}
          onChanged={() => setSafetyVersion((value) => value + 1)}
        />
      )}
      <CallOverlay
        incomingCall={call.incomingCall}
        activeCall={call.activeCall}
        currentUserId={user?.id ?? ""}
        users={callConversation?.members ?? []}
        localStream={call.localStream}
        remoteStreams={call.remoteStreams}
        microphoneMuted={call.microphoneMuted}
        cameraEnabled={call.cameraEnabled}
        error={call.callError}
        onAccept={() => void call.acceptCall()}
        onDecline={call.declineCall}
        onEnd={call.endCall}
        onToggleMicrophone={call.toggleMicrophone}
        onToggleCamera={call.toggleCamera}
        onClearError={call.clearCallError}
      />
    </div>
  );
}
