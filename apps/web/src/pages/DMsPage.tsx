import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import LiveRoomsBar, { fetchLiveRooms } from "../components/LiveRoomsBar.js";
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
const PINNED_CHATS_KEY = "intouch:pinned-chats";
const UNREAD_FIRST_KEY = "intouch:unread-first";

interface PendingMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  mediaKey?: string | null;
}

interface ReplyTarget {
  id: string;
  senderUsername: string;
  text: string;
}

function extractLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s]+/g);
  if (!matches) return [];
  return [...new Set(matches)].slice(0, 6);
}

function labelForDeliveryState(state: ConversationMessage["deliveryState"] | undefined): string {
  if (!state) return "Sent";
  if (state === "read") return "Read";
  if (state === "delivered") return "Delivered";
  if (state === "pending") return "Pending";
  return "Sent";
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

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
  const { data: liveRooms = [] } = useQuery({
    queryKey: ["live-rooms"],
    queryFn: fetchLiveRooms,
    enabled: !!user,
    refetchInterval: 30_000,
  });
  const hasJoinableLiveRoom = liveRooms.some((room) => !room.participantIds.includes(user?.id ?? ""));

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["live-rooms"] });
    socket.on("live-rooms:changed", refresh);
    return () => {
      socket.off("live-rooms:changed", refresh);
    };
  }, [queryClient]);
  const call = useWebRtcCall(user?.id);
  const friendPickerRef = useRef<HTMLDivElement>(null);
  const friendSearchInputRef = useRef<HTMLInputElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const scrolledConversationRef = useRef<string | null>(null);
  const wasAtBottomRef = useRef(true);
  const topAutoLoadReadyRef = useRef(true);
  const prependScrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number; count: number } | null>(null);
  const lastVisibleMessageIdRef = useRef<string | null>(null);
  const unreadAnchoredConversationRef = useRef<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get("conversation"));
  const [chatSearch, setChatSearch] = useState("");
  const [chatFilter, setChatFilter] = useState<"all" | "unread" | "groups">("all");
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(PINNED_CHATS_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [unreadFirst, setUnreadFirst] = useState<boolean>(() => {
    try {
      return localStorage.getItem(UNREAD_FIRST_KEY) === "1";
    } catch {
      return false;
    }
  });
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
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [initialUnreadCount, setInitialUnreadCount] = useState(0);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const [messageReactions, setMessageReactions] = useState<Record<string, string>>({});
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());
  const replySwipeRef = useRef<{ id: string; startX: number; startY: number; mode: "x" | "y" | null } | null>(null);
  const longPressRef = useRef<number | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const recorder = useAudioRecorder({ maxMs: MAX_VOICE_MESSAGE_MS, onFinished: (recording) => void sendVoice(recording) });

  useEffect(() => {
    if (searchParams.get("view") !== "live_rooms") return;
    setActiveId(null);
    setMessageView("live_rooms");
  }, [searchParams]);

  useEffect(() => {
    localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify(pinnedChatIds.slice(0, 30)));
  }, [pinnedChatIds]);

  useEffect(() => {
    localStorage.setItem(UNREAD_FIRST_KEY, unreadFirst ? "1" : "0");
  }, [unreadFirst]);

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
  const unreadAnchorMessageId = initialUnreadCount > 0
    ? messages[Math.max(0, messages.length - initialUnreadCount)]?.id ?? null
    : null;

  useLayoutEffect(() => {
    if (!activeId) {
      // Reopening the same chat must pin to the newest message again.
      scrolledConversationRef.current = null;
      unreadAnchoredConversationRef.current = null;
      return;
    }
    if (!messagesLoaded || !messageScrollRef.current) return;
    const container = messageScrollRef.current;

    if (scrolledConversationRef.current !== activeId) {
      container.scrollTop = container.scrollHeight;
      wasAtBottomRef.current = true;
      scrolledConversationRef.current = activeId;
      lastVisibleMessageIdRef.current = newestMessageId;
      pinToBottomFor(700);
      return;
    }

    if (prependScrollAnchorRef.current && messages.length > prependScrollAnchorRef.current.count) {
      const { scrollHeight, scrollTop } = prependScrollAnchorRef.current;
      const delta = container.scrollHeight - scrollHeight;
      container.scrollTop = scrollTop + delta;
      wasAtBottomRef.current = container.scrollHeight - (container.scrollTop + container.clientHeight) <= 120;
      prependScrollAnchorRef.current = null;
      lastVisibleMessageIdRef.current = newestMessageId;
      return;
    }

    if (newestMessageId && newestMessageId !== lastVisibleMessageIdRef.current) {
      if (wasAtBottomRef.current) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
      lastVisibleMessageIdRef.current = newestMessageId;
    } else if (wasAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeId, decryptedMessages, messages.length, messagesLoaded, newestMessageId]);

  useLayoutEffect(() => {
    if (!activeId || !messagesLoaded || !messageScrollRef.current) return;
    if (initialUnreadCount <= 0 || !unreadAnchorMessageId) return;
    if (unreadAnchoredConversationRef.current === activeId) return;
    const target = messageRefs.current[unreadAnchorMessageId];
    if (!target) return;
    unreadAnchoredConversationRef.current = activeId;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [activeId, initialUnreadCount, messagesLoaded, unreadAnchorMessageId]);

  // Late layout changes (decryption, thumbnails) keep the view on the newest message until the user scrolls.
  function pinToBottomFor(durationMs: number) {
    const end = performance.now() + durationMs;
    const tick = () => {
      const container = messageScrollRef.current;
      if (!container || !wasAtBottomRef.current) return;
      container.scrollTop = container.scrollHeight;
      if (performance.now() < end) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function trackMessageScroll() {
    const container = messageScrollRef.current;
    if (!container) return;
    const distance = container.scrollHeight - (container.scrollTop + container.clientHeight);
    wasAtBottomRef.current = distance <= 120;
    setShowJumpToLatest(distance > 320);
    if (container.scrollTop > 140) topAutoLoadReadyRef.current = true;
    if (container.scrollTop < 60 && topAutoLoadReadyRef.current) {
      topAutoLoadReadyRef.current = false;
      loadOlderMessages();
    }
  }

  function jumpToLatest() {
    messageScrollRef.current?.scrollTo({ top: messageScrollRef.current.scrollHeight, behavior: "smooth" });
  }

  useEffect(() => {
    if (!activeId) return;
    document.body.dataset.chatOpen = "1";
    return () => {
      delete document.body.dataset.chatOpen;
    };
  }, [activeId]);

  useEffect(() => {
    if (!messageText && composerInputRef.current) composerInputRef.current.style.height = "";
  }, [messageText]);

  useEffect(() => {
    if (!activeId) {
      setInitialUnreadCount(0);
      return;
    }
    const unread = conversations.find((conversation) => conversation.id === activeId)?.unreadCount ?? 0;
    setInitialUnreadCount(unread);
  }, [activeId, conversations]);
  const { data: encryptionKeys = [], isError: encryptionKeysError } = useQuery({
    queryKey: ["conversation-encryption-keys", activeId],
    queryFn: () => fetchEncryptionKeys(activeId!),
    enabled: !!activeId && deviceKeyReady,
  });
  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const callConversationId = call.activeCall?.conversationId ?? call.incomingCall?.conversationId;
  const callConversation = conversations.find((conversation) => conversation.id === callConversationId);
  const canCall = !!activeConversation && activeConversation.members.length >= 2 && activeConversation.members.length <= MAX_LIVE_ROOM_PARTICIPANTS;
  const normalizedChatSearch = chatSearch.trim().replace(/^@/, "").toLocaleLowerCase();
  const pinnedSet = useMemo(() => new Set(pinnedChatIds), [pinnedChatIds]);
  const visibleConversations = useMemo(() => {
    const filtered = conversations.filter((conversation) => {
      if (chatFilter === "unread" && conversation.unreadCount === 0) return false;
      if (chatFilter === "groups" && !conversation.isGroup) return false;
      if (!normalizedChatSearch) return true;
      const conversationText = [
        conversation.name ?? "",
        conversation.otherMember?.username ?? "",
        conversation.otherMember?.displayName ?? "",
        conversation.members.map((member) => member.username).join(" "),
        conversation.lastMessage && !conversation.lastMessage.isEncrypted ? conversation.lastMessage.text ?? "" : "",
      ].join(" ").toLocaleLowerCase();
      return conversationText.includes(normalizedChatSearch);
    });

    return filtered.sort((a, b) => {
      const aPinned = pinnedSet.has(a.id);
      const bPinned = pinnedSet.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      if (unreadFirst && a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      const aTime = a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0;
      const bTime = b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0;
      return bTime - aTime;
    });
  }, [chatFilter, conversations, normalizedChatSearch, pinnedSet, unreadFirst]);
  const membersWithKeys = new Set(encryptionKeys.map((key) => key.userId));
  const allMembersHaveKeys = !!activeConversation &&
    activeConversation.members.length > 0 &&
    activeConversation.members.every((member) => membersWithKeys.has(member.id));
  const parsedMessages = messages.map((message) => ({
    message,
    parsed: parseMessageContent(message.isEncrypted ? decryptedMessages[message.id] ?? "" : message.text ?? ""),
    decrypting: message.isEncrypted && decryptedMessages[message.id] === undefined,
  }));
  const visibleParsedMessages = parsedMessages.filter(({ message }) => !hiddenMessageIds.has(message.id));
  const visiblePendingMessages = pendingMessages
    .filter((pending) => pending.conversationId === activeId)
    .map((pending) => ({
      message: pending,
      parsed: parseMessageContent(pending.text),
      decrypting: false,
      pending: true,
    }));
  const sharedLinkTargets = useMemo(() => {
    const links: string[] = [];
    for (const { parsed } of visibleParsedMessages) {
      if (parsed.kind !== "text") continue;
      links.push(...extractLinks(parsed.text));
    }
    return [...new Set(links)].slice(0, 4);
  }, [visibleParsedMessages]);
  const sharedMediaKeys = useMemo(() => {
    return visibleParsedMessages
      .map(({ parsed }) => parsed.kind === "voice" ? parsed.voice.mediaKey : null)
      .filter((item): item is string => Boolean(item))
      .slice(-3)
      .reverse();
  }, [visibleParsedMessages]);
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

  useEffect(() => () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

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
      count: messages.length,
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
    const draft = messageText;
    const replyContext = storyReplyContext;
    const activeReplyTarget = replyTarget;
    const wrappedReply = activeReplyTarget
      ? `↪ @${activeReplyTarget.senderUsername}: ${activeReplyTarget.text}\n${draft.trim()}`
      : draft.trim();
    const pendingId = `pending-${crypto.randomUUID()}`;
    const pendingText = replyContext
      ? JSON.stringify({
          type: "story_reply",
          story: replyContext,
          text: wrappedReply,
        })
      : wrappedReply;
    setPendingMessages((current) => [...current, {
      id: pendingId,
      conversationId: activeId,
      senderId: user?.id ?? "",
      text: pendingText,
      createdAt: new Date().toISOString(),
    }]);
    // Clear right away so the next message can be typed while this one is still being sent.
    setMessageText("");
    setStoryReplyContext(null);
    setReplyTarget(null);
    try {
      const messageContent = replyContext
        ? JSON.stringify({
            type: "story_reply",
            story: replyContext,
            text: wrappedReply,
          })
        : wrappedReply;
      await sendEncrypted(messageContent);
      setPendingMessages((current) => current.filter((message) => message.id !== pendingId));
    } catch (error) {
      setPendingMessages((current) => current.filter((message) => message.id !== pendingId));
      setMessageText((current) => current || draft);
      setStoryReplyContext(replyContext);
      setReplyTarget(activeReplyTarget);
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

  function togglePinnedChat(conversationId: string) {
    setPinnedChatIds((current) => current.includes(conversationId)
      ? current.filter((id) => id !== conversationId)
      : [conversationId, ...current]);
  }

  function onMessagePointerDown(messageId: string, event: React.PointerEvent<HTMLDivElement>) {
    if (!activeConversation) return;
    replySwipeRef.current = { id: messageId, startX: event.clientX, startY: event.clientY, mode: null };
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = window.setTimeout(() => {
      setActionMessageId(messageId);
      replySwipeRef.current = null;
    }, 420);
  }

  function onMessagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const swipe = replySwipeRef.current;
    if (!swipe) return;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    if (!swipe.mode && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      swipe.mode = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
      if (longPressRef.current !== null) {
        window.clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    }
  }

  function onMessagePointerUp(messageId: string, senderUsername: string, text: string, event: React.PointerEvent<HTMLDivElement>) {
    const swipe = replySwipeRef.current;
    replySwipeRef.current = null;
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    if (!swipe || swipe.id !== messageId || swipe.mode !== "x") return;
    const deltaX = event.clientX - swipe.startX;
    if (deltaX > 72) {
      setReplyTarget({ id: messageId, senderUsername, text: text.trim().slice(0, 120) || "message" });
      composerInputRef.current?.focus();
    }
  }

  const renderedMessages = [
    ...visibleParsedMessages.map((entry) => ({ ...entry, pending: false })),
    ...visiblePendingMessages,
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PullToRefresh enabled={!activeId && !call.activeCall && !call.incomingCall} onRefresh={async () => {
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
              <span className={hasJoinableLiveRoom ? "live-tab-pulse" : ""}>Live Rooms</span>
            </button>
          </div>
          {messageView !== "live_rooms" && <form
            onSubmit={(event) => {
              event.preventDefault();
              if (groupMode) void startGroup();
              else if (matchingFriends[0]) void startConversation(matchingFriends[0].username);
            }}
            className="mb-3 flex flex-col gap-3"
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
                ref={friendSearchInputRef}
                value={friendSearch}
                onFocus={() => setFriendPickerOpen(true)}
                onChange={(e) => {
                  setFriendSearch(e.target.value);
                  setFriendPickerOpen(true);
                }}
                placeholder={groupMode ? "Search friends to add" : "Search friends by name or @username"}
                className={`${input} w-full rounded-full px-4`}
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
          {messageView === "chats" && (
            <div className="mb-3 space-y-2">
              <div className="flex items-center gap-2">
                <label htmlFor="chat-search" className="sr-only">Search chats</label>
                <input
                  id="chat-search"
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  placeholder="Search chats"
                  className={`${input} min-h-10 flex-1 rounded-full px-4`}
                />
                <button
                  type="button"
                  onClick={() => {
                    setFriendPickerOpen(true);
                    friendSearchInputRef.current?.focus();
                  }}
                  className="rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                >
                  New chat
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChatFilter("all")}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${chatFilter === "all" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter("unread")}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${chatFilter === "unread" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  Unread
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter("groups")}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${chatFilter === "groups" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  Groups
                </button>
                <button
                  type="button"
                  onClick={() => setUnreadFirst((value) => !value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${unreadFirst ? "border-emerald-700 bg-emerald-700 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  Unread first
                </button>
              </div>
            </div>
          )}
          {messageView === "chats" && <div className={activityList}>
            {visibleConversations.map((c) => (
              <div key={c.id} className={`${activityRow} relative`}>
                <button
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
                      <span className={`min-w-0 flex-1 truncate text-sm text-gray-900 ${c.unreadCount > 0 ? "font-bold" : "font-semibold"}`}>
                        {c.isGroup
                          ? c.name ?? c.members.map((member) => `@${member.username}`).join(", ")
                          : `@${c.otherMember?.username ?? "Unknown"}`}
                      </span>
                      {c.lastMessage && (
                        <time className={`shrink-0 text-[11px] ${c.unreadCount > 0 ? "font-semibold text-green-600" : "text-gray-400"}`}>
                          {formatActivityTime(c.lastMessage.createdAt)}
                        </time>
                      )}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-2">
                      {c.lastMessage?.isEncrypted && (
                        <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500">
                          <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                        </span>
                      )}
                      <span className={`min-w-0 flex-1 truncate text-[13px] leading-5 ${c.unreadCount > 0 ? "font-medium text-gray-800" : "text-gray-500"}`}>
                        {c.lastMessage ? (c.lastMessage.isEncrypted ? "End-to-end encrypted message" : c.lastMessage.text) : "No messages yet"}
                      </span>
                      {c.unreadCount > 0 && (
                        <span
                          aria-label={`${c.unreadCount} unread messages`}
                          className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-green-600 px-1.5 text-[11px] font-bold text-white"
                        >
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => togglePinnedChat(c.id)}
                  aria-label={pinnedSet.has(c.id) ? "Unpin chat" : "Pin chat"}
                  aria-pressed={pinnedSet.has(c.id)}
                  title={pinnedSet.has(c.id) ? "Unpin chat" : "Pin chat"}
                  className={`ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 ${pinnedSet.has(c.id) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-transparent text-gray-400 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-700"}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3.5h8l-1 5 3 3v2h-5v6.5L12 22l-1-2v-6.5H6v-2l3-3-1-5Z" />
                  </svg>
                </button>
              </div>
            ))}
            {visibleConversations.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-500">No conversations yet.</p>
            )}
          </div>}
          {messageView === "chats" && (
            <p className="mt-4 flex items-center justify-center gap-1.5 px-4 text-center text-[11px] leading-5 text-gray-500">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3 w-3 shrink-0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              {deviceKeyReady ? "Your messages are end-to-end encrypted on this device." : "Preparing encrypted messaging for this device."}
            </p>
          )}
          {messageView === "live_rooms" && <LiveRoomsBar />}
        </div>}

        {activeId && (
          <section
            key={activeId}
            className="message-conversation-enter fixed inset-x-0 top-0 z-[56] flex flex-col bg-gray-50"
            style={{ bottom: keyboardOffset }}
            aria-label="Conversation"
          >
            <div className="shrink-0 border-b border-gray-200 bg-white/95 backdrop-blur-xl">
              <div className="mx-auto flex w-full max-w-2xl items-center gap-1.5 px-1.5 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(null);
                    setSearchParams({});
                  }}
                  aria-label="Back to Messages"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-700 transition-[background-color,transform] hover:bg-gray-100 active:scale-90"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                </button>
                {activeConversation?.isGroup ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700">
                    {activeConversation.members.length}
                  </span>
                ) : activeConversation?.otherMember ? (
                  <Link
                    to={`/u/${activeConversation.otherMember.username}`}
                    aria-label={`Open @${activeConversation.otherMember.username} profile`}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 transition-colors hover:bg-gray-100"
                  >
                    <Avatar avatarKey={activeConversation.otherMember.avatarKey} username={activeConversation.otherMember.username} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold leading-5 text-gray-900">
                        @{activeConversation.otherMember.username}
                      </span>
                      <span className={`block truncate text-[11px] leading-4 ${deviceKeyReady && allMembersHaveKeys && !encryptionKeysError ? "text-green-700" : "text-amber-700"}`}>
                        {deviceKeyReady && allMembersHaveKeys && !encryptionKeysError ? "End-to-end encrypted" : "Not ready for encryption yet"}
                      </span>
                    </span>
                  </Link>
                ) : null}
                <div className={`min-w-0 ${activeConversation?.otherMember && !activeConversation?.isGroup ? "hidden" : "flex-1 pl-1"}`}>
                  <h2 className="truncate text-[15px] font-semibold leading-5 text-gray-900">
                    {activeConversation?.isGroup
                      ? activeConversation.name ?? activeConversation.members.map((member) => `@${member.username}`).join(", ")
                      : `@${activeConversation?.otherMember?.username ?? "Conversation"}`}
                  </h2>
                  <p className={`truncate text-[11px] leading-4 ${deviceKeyReady && allMembersHaveKeys && !encryptionKeysError ? "text-green-700" : "text-amber-700"}`}>
                    {deviceKeyReady && allMembersHaveKeys && !encryptionKeysError
                      ? (activeConversation?.isGroup ? `${activeConversation.members.length} members · end-to-end encrypted` : "End-to-end encrypted")
                      : "Not ready for encryption yet"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSecurityOpen(true)}
                  aria-label="Security code"
                  title={securityStatus === "verified" ? "Security code verified" : securityStatus === "changed" ? "Security code changed" : "Verify security code"}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-[background-color,transform] hover:bg-gray-100 active:scale-90 ${securityStatus === "changed" ? "text-amber-700" : securityStatus === "verified" ? "text-green-700" : "text-gray-600"}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[20px] w-[20px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
                  className="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-[background-color,transform] hover:bg-gray-100 active:scale-90 disabled:opacity-40"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[20px] w-[20px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.6 3.5h3l1.5 4.2-2 1.5a14 14 0 0 0 5.7 5.7l1.5-2 4.2 1.5v3a1.6 1.6 0 0 1-1.8 1.6A16.7 16.7 0 0 1 4.9 5.3 1.6 1.6 0 0 1 6.6 3.5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => activeId && void call.startCall(activeId, "video")}
                  disabled={!canCall || !!call.activeCall || !!call.incomingCall}
                  aria-label="Start video call"
                  title="Video call"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-[background-color,transform] hover:bg-gray-100 active:scale-90 disabled:opacity-40"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[20px] w-[20px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="6" width="12" height="12" rx="2" />
                    <path d="m15 10 6-3v10l-6-3" />
                  </svg>
                </button>
              </div>
            </div>
            {encryptionKeysError && (
              <p role="alert" className="mx-4 mt-2 text-xs text-red-600">Could not load conversation encryption keys.</p>
            )}
            {(sharedMediaKeys.length > 0 || sharedLinkTargets.length > 0) && (
              <div className="mx-auto flex w-full max-w-2xl items-center gap-2 overflow-x-auto border-b border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 sm:px-[max(0.75rem,calc((100%-42rem)/2))]">
                {sharedMediaKeys.map((mediaKey) => (
                  <button
                    key={mediaKey}
                    type="button"
                    onClick={() => setMessageText((current) => `${current ? `${current}\n` : ""}${mediaUrl(mediaKey)}`)}
                    className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 hover:bg-gray-100"
                  >
                    Voice clip
                  </button>
                ))}
                {sharedLinkTargets.map((link) => (
                  <a
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-[210px] shrink-0 truncate rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 hover:bg-gray-100"
                  >
                    {link.replace(/^https?:\/\//, "")}
                  </a>
                ))}
              </div>
            )}
            <div ref={messageScrollRef} onScroll={trackMessageScroll} style={conversationBackgroundStyle} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain [overflow-anchor:none] px-3 py-3 sm:px-[max(0.75rem,calc((100%-42rem)/2))]">
              {messagesQuery.isPending && (
                <div aria-hidden="true" className="space-y-2 px-1 py-2">
                  <div className="chat-bubble chat-bubble-theirs h-16 animate-pulse" />
                  <div className="chat-bubble chat-bubble-mine ml-auto h-12 animate-pulse" />
                  <div className="chat-bubble chat-bubble-theirs h-20 animate-pulse" />
                </div>
              )}
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
              {renderedMessages.map(({ message, parsed, decrypting, pending }, messageIndex) => {
                if (parsed.kind === "rsvp" || parsed.kind === "meetup_cancel") return null;
                const mine = message.senderId === user?.id;
                const isPending = pending;
                const sender = activeConversation?.members.find((member) => member.id === message.senderId);
                const previousMessage = renderedMessages[messageIndex - 1]?.message;
                const startsNewDay = !previousMessage || dayKey(previousMessage.createdAt) !== dayKey(message.createdAt);
                const startsGroup = startsNewDay || previousMessage.senderId !== message.senderId;
                const dayDivider = startsNewDay ? (
                  <div key={`day-${message.id}`} className="my-2 self-center rounded-full bg-white/90 px-3 py-0.5 text-[11px] font-medium text-gray-500 shadow-sm">
                    {formatDayLabel(message.createdAt)}
                  </div>
                ) : null;

                if (parsed.kind === "meetup" && !isPending) {
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
                    <Fragment key={message.id}>
                    {dayDivider}
                    <div className={`flex max-w-[92%] flex-col gap-1 ${startsGroup ? "mt-2" : ""} ${mine ? "self-end items-end" : "self-start items-start"}`}>
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
                    </Fragment>
                  );
                }

                const replyPreview = parsed.kind === "text"
                  ? parsed.text.slice(0, 180)
                  : parsed.kind === "voice"
                    ? "Voice message"
                    : "Message";

                return (
                  <Fragment key={message.id}>
                  {dayDivider}
                  <div
                    ref={(node) => {
                      messageRefs.current[message.id] = node;
                    }}
                    onPointerDown={(event) => onMessagePointerDown(message.id, event)}
                    onPointerMove={onMessagePointerMove}
                    onPointerUp={(event) => onMessagePointerUp(message.id, sender?.username ?? "someone", replyPreview, event)}
                    onPointerCancel={() => {
                      replySwipeRef.current = null;
                      if (longPressRef.current !== null) {
                        window.clearTimeout(longPressRef.current);
                        longPressRef.current = null;
                      }
                    }}
                    className={`chat-bubble transition-transform ${startsGroup ? "mt-2" : ""} ${mine ? "chat-bubble-mine self-end" : "chat-bubble-theirs self-start"} ${isPending ? "opacity-75" : ""}`}
                  >
                    {unreadAnchorMessageId === message.id && (
                      <div className="-mt-1 mb-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        New messages
                      </div>
                    )}
                    {!mine && startsGroup && activeConversation?.isGroup && (
                      <span className="mb-0.5 block text-[12px] font-semibold text-emerald-700">@{sender?.username ?? "someone"}</span>
                    )}
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
                      <VoiceMessage voice={parsed.voice} tone="light" />
                    ) : parsed.kind === "text" ? (
                      <p className="whitespace-pre-wrap">{decrypting ? "Decrypting message..." : parsed.text}</p>
                    ) : parsed.kind === "meetup" ? (
                      <p className="whitespace-pre-wrap">Meetup: {parsed.meetup.title}</p>
                    ) : (
                      <p className="whitespace-pre-wrap">Message</p>
                    )}
                    {messageReactions[message.id] && (
                      <div className="mt-1 inline-flex rounded-full bg-black/8 px-2 py-0.5 text-xs">
                        {messageReactions[message.id]}
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] leading-4 opacity-60">
                      {"isEncrypted" in message && !message.isEncrypted && <span className="font-semibold text-red-600">Not encrypted</span>}
                      {mine && (
                        <span className="font-semibold text-gray-600">{isPending ? "Pending" : labelForDeliveryState((message as ConversationMessage).deliveryState)}</span>
                      )}
                      <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
                    </div>
                    {actionMessageId === message.id && (
                      <div className="mt-2 flex flex-wrap gap-1.5 rounded-xl border border-black/10 bg-white/95 p-1.5 text-xs text-gray-700 shadow-sm">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(replyPreview).catch(() => undefined);
                            setActionMessageId(null);
                          }}
                          className="rounded-full border border-gray-200 px-2 py-1 hover:bg-gray-50"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTarget({ id: message.id, senderUsername: sender?.username ?? "someone", text: replyPreview.slice(0, 120) });
                            setActionMessageId(null);
                            composerInputRef.current?.focus();
                          }}
                          className="rounded-full border border-gray-200 px-2 py-1 hover:bg-gray-50"
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMessageText((current) => `${current ? `${current}\n` : ""}Fwd: ${replyPreview}`);
                            setActionMessageId(null);
                            composerInputRef.current?.focus();
                          }}
                          className="rounded-full border border-gray-200 px-2 py-1 hover:bg-gray-50"
                        >
                          Forward
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setHiddenMessageIds((current) => {
                              const next = new Set(current);
                              next.add(message.id);
                              return next;
                            });
                            setActionMessageId(null);
                          }}
                          className="rounded-full border border-gray-200 px-2 py-1 hover:bg-gray-50"
                        >
                          Delete for me
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMessageReactions((current) => ({ ...current, [message.id]: "❤️" }));
                            setActionMessageId(null);
                          }}
                          className="rounded-full border border-gray-200 px-2 py-1 hover:bg-gray-50"
                        >
                          React ❤️
                        </button>
                      </div>
                    )}
                  </div>
                  </Fragment>
                );
              })}
              {renderedMessages.length === 0 && (
                <p className="self-center rounded-full bg-white/90 px-3 py-1 text-xs text-gray-500 shadow-sm">No messages yet. Say hi!</p>
              )}
              {showJumpToLatest && (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  aria-label="Jump to latest message"
                  className="sticky bottom-1 z-10 mt-1 flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-full border border-gray-200 bg-white text-gray-600 shadow-md transition-transform active:scale-90"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              )}
            </div>
            {messageError && <p role="alert" className="shrink-0 bg-red-50 px-4 py-1.5 text-xs text-red-700">{messageError}</p>}
            {storyReplyContext && (
              <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-3 border-t border-gray-200 bg-white p-2">
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
              className="shrink-0 border-t border-gray-200 bg-white/95 px-2 pt-2 backdrop-blur-xl"
              style={{ paddingBottom: keyboardOffset > 0 ? "0.5rem" : "max(0.5rem, env(safe-area-inset-bottom))" }}
            >
              <div className="mx-auto w-full max-w-2xl">
              {replyTarget && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <span className="min-w-0 flex-1 truncate">
                    Replying to @{replyTarget.senderUsername}: {replyTarget.text}
                  </span>
                  <button type="button" onClick={() => setReplyTarget(null)} className="rounded-full px-2 py-0.5 text-emerald-800 hover:bg-emerald-100">Cancel</button>
                </div>
              )}
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 text-xs">
                {["On my way", "Seen", "Call you in 5", "😂"].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setMessageText((current) => current ? `${current} ${chip}` : chip)}
                    className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-gray-700 hover:bg-gray-100"
                  >
                    {chip}
                  </button>
                ))}
              </div>
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
                <form onSubmit={(e) => void sendMessage(e)} className="flex items-end gap-2">
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
                  <textarea
                    ref={composerInputRef}
                    value={messageText}
                    rows={1}
                    enterKeyHint="send"
                    onFocus={() => {
                      window.setTimeout(() => {
                        messageScrollRef.current?.scrollTo({
                          top: messageScrollRef.current.scrollHeight,
                          behavior: "smooth",
                        });
                      }, 60);
                    }}
                    onChange={(e) => {
                      setMessageText(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
                    }}
                    onKeyDown={(e) => {
                      // Desktop: Enter sends, Shift+Enter adds a line. On touch screens Enter stays a new line.
                      if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder={voiceBusy ? "Sending voice message..." : "Message"}
                    aria-label="Message"
                    className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-3xl border border-gray-200 bg-white px-4 py-2 text-[15px] leading-6 text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none"
                  />
                  {messageText.trim() || voiceBusy ? (
                    <button
                      type="submit"
                      aria-label="Send message"
                      disabled={!deviceKeyReady || !allMembersHaveKeys || voiceBusy}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-700 text-white transition-transform hover:bg-green-800 active:scale-90 disabled:opacity-50"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12 20 4l-4 16-4.5-6.5L5 12Zm6.5 1.5L20 4" /></svg>
                    </button>
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
        remoteMuted={call.remoteMuted}
        remoteCameraOff={call.remoteCameraOff}
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
