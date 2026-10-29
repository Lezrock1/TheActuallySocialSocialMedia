import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
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
import { useCalls } from "../components/CallProvider.js";
import { getSocket } from "../lib/socket.js";
import { downloadMediaBlob, mediaUrl, uploadMedia } from "../lib/upload.js";
import { useConversationBackground } from "../lib/pageBackground.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import { getTimeZone } from "../lib/theme.js";
import Avatar from "../components/Avatar.js";
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
import { ConversationRowsSkeleton, InlineSkeletonText } from "../components/LoadingSkeleton.js";
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
import type { MeetupContent, SnapReplyContext, StoryReplyContext } from "../lib/messageContent.js";
import { clearLocalMeetupReminder, getLocalMeetupReminderMinutes, setLocalMeetupReminder, syncLocalChatMeetupReminders } from "../lib/localMeetupReminders.js";
import { computePeaks, decryptMediaBlob, encryptAudioBlob, encryptMediaBlob } from "../lib/voice.js";
import { captureVideoPoster } from "../lib/video.js";
import { formatDuration, isAudioRecordingSupported, useAudioRecorder } from "../lib/useAudioRecorder.js";
import type { AudioRecording } from "../lib/useAudioRecorder.js";
import { MAX_VOICE_MESSAGE_MS } from "@app/shared";
import { UNREAD_FIRST_KEY, useListPreference } from "../lib/listPreferences.js";

const MESSAGE_PAGE_LIMIT = 40;
const PINNED_CHATS_KEY = "intouch:pinned-chats";
const REACTION_CHOICES = ["❤️", "👍", "😂", "😮", "😢", "🙏"];
const REPLY_SWIPE_THRESHOLD = 72;

function insertMessageIntoCache(queryClient: QueryClient, conversationId: string, message: ConversationMessage) {
  queryClient.setQueryData<InfiniteData<ConversationMessagesPage>>(["messages", conversationId], (current) => {
    if (!current || current.pages.length === 0) return current;
    const [latestPage, ...olderPages] = current.pages;
    if (current.pages.some((page) => page.messages.some((existing) => existing.id === message.id))) return current;
    return { ...current, pages: [{ ...latestPage, messages: [...latestPage.messages, message] }, ...olderPages] };
  });
}

function clearUnreadInCache(queryClient: QueryClient, conversationId: string) {
  queryClient.setQueryData<ConversationSummary[]>(["conversations"], (current) =>
    current?.some((conversation) => conversation.id === conversationId && conversation.unreadCount > 0)
      ? current.map((conversation) => conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation)
      : current);
}

function TypingDots() {
  return <span aria-hidden="true" className="typing-dots"><span /><span /><span /></span>;
}

function ChatListSkeleton() {
  return (
    <div role="status" className="px-1">
      <span className="sr-only">Loading chats...</span>
      <ConversationRowsSkeleton rows={6} />
    </div>
  );
}

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

interface SnapReplyDraftContext {
  snapId: string;
  authorUsername: string;
  createdAt: string;
  image: Blob;
}

function LocalBlobImage({ blob, alt, className }: { blob: Blob | null; alt: string; className: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [blob]);
  return url ? <img src={url} alt={alt} className={className} /> : <span aria-label="Snap preview loading" className={`${className} bg-gray-200`} />;
}

function EncryptedSnapThumbnail({ mediaKey, reply }: { mediaKey: string; reply: SnapReplyContext }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    void downloadMediaBlob(mediaKey)
      .then((ciphertext) => decryptMediaBlob(ciphertext, reply.key, reply.iv, "image/jpeg"))
      .then((preview) => { if (!cancelled) setBlob(preview); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [mediaKey, reply.iv, reply.key]);
  return <LocalBlobImage blob={blob} alt={`Snap from @${reply.authorUsername}`} className="h-14 w-10 shrink-0 rounded object-cover" />;
}

async function createSnapReplyThumbnail(image: Blob): Promise<Blob> {
  const source = image.type.startsWith("video/")
    ? await captureVideoPoster(new File([image], "snap-video", { type: image.type }))
    : image;
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create Snap preview");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const preview = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!preview) throw new Error("Could not create Snap preview");
    return preview;
  } finally {
    bitmap.close();
  }
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
  return new Date(iso).toLocaleTimeString([], { timeZone: getTimeZone(), hour: "2-digit", minute: "2-digit" });
}

function chatPreview(message: ConversationSummary["lastMessage"]): string {
  if (!message) return "No messages yet";
  if (message.isEncrypted) return "End-to-end encrypted message";
  const parsed = parseMessageContent(message.text ?? "");
  if (parsed.kind !== "call") return message.text ?? "";
  const label = parsed.callType === "video" ? "Video call" : "Audio call";
  if (parsed.status === "missed") return `Missed ${label.toLowerCase()}`;
  if (parsed.status === "declined") return `${label} declined`;
  if (parsed.status === "completed") return `${label} · ${formatDuration(parsed.durationSeconds * 1000)}`;
  return `${label} · ${parsed.status === "ongoing" ? "In progress" : "Ringing"}`;
}

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: getTimeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString([], {
    timeZone: getTimeZone(),
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
  const call = useCalls();
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
  const [chatFilter, setChatFilter] = useState<"all" | "unread" | "groups" | "pinned">("all");
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(PINNED_CHATS_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [unreadFirst] = useListPreference(UNREAD_FIRST_KEY);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());
  const [friendSearch, setFriendSearch] = useState("");
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [selectedGroupUsernames, setSelectedGroupUsernames] = useState<string[]>([]);
  const [startingConversation, setStartingConversation] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [storyReplyContext, setStoryReplyContext] = useState<StoryReplyContext | null>(null);
  const [snapReplyContext, setSnapReplyContext] = useState<SnapReplyDraftContext | null>(null);
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
  const [unreadAnchorMessageId, setUnreadAnchorMessageId] = useState<string | null>(null);
  const [newBelowCount, setNewBelowCount] = useState(0);
  const [chatClosing, setChatClosing] = useState(false);
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string[]>>({});
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const unreadAnchorSetRef = useRef<string | null>(null);
  const [unreadCapturedId, setUnreadCapturedId] = useState<string | null>(null);
  const typingTimersRef = useRef<Map<string, number>>(new Map());
  const typingSentAtRef = useRef(0);
  const typingStopTimerRef = useRef<number | null>(null);
  const sendKeepFocusRef = useRef(false);
  const replySwipeRef = useRef<{ id: string; startX: number; startY: number; mode: "x" | "y" | null; el: HTMLDivElement; armed: boolean } | null>(null);
  const longPressRef = useRef<number | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const recorder = useAudioRecorder({ maxMs: MAX_VOICE_MESSAGE_MS, onFinished: (recording) => void sendVoice(recording) });

  useEffect(() => {
    if (searchParams.get("view") !== "live_rooms") return;
    setActiveId(null);
    setMessageView("live_rooms");
  }, [searchParams]);

  useEffect(() => {
    const conversationId = searchParams.get("conversation");
    if (conversationId) { setActiveId(conversationId); setMessageView("chats"); }
  }, [searchParams]);

  useEffect(() => {
    localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify(pinnedChatIds.slice(0, 30)));
  }, [pinnedChatIds]);

  useEffect(() => {
    const state = location.state as {
      draftMessage?: unknown;
      storyReply?: Partial<StoryReplyContext>;
      snapReply?: Partial<SnapReplyDraftContext>;
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
    if (
      typeof state.snapReply?.snapId === "string" &&
      typeof state.snapReply.authorUsername === "string" &&
      typeof state.snapReply.createdAt === "string" &&
      state.snapReply.image instanceof Blob
    ) {
      setSnapReplyContext({
        snapId: state.snapReply.snapId,
        authorUsername: state.snapReply.authorUsername,
        createdAt: state.snapReply.createdAt,
        image: state.snapReply.image,
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

  const { data: conversations = [], isLoading: conversationsLoading, isError: conversationsFailed, refetch: retryConversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
  });

  useEffect(() => {
    if (!user) return;
    const contactIds = [...new Set(conversations.flatMap((conversation) =>
      conversation.members
        .filter((member) => member.id !== user.id)
        .map((member) => member.id)
    ))];
    const socket = getSocket();
    function onPresenceUpdate(payload: { userId?: unknown; isOnline?: unknown }) {
      if (typeof payload.userId !== "string" || typeof payload.isOnline !== "boolean") return;
      setOnlineUserIds((current) => {
        const next = new Set(current);
        if (payload.isOnline) next.add(payload.userId as string);
        else next.delete(payload.userId as string);
        return next;
      });
    }
    function checkPresence() {
      socket.emit("presence:check", contactIds, (onlineIds: unknown) => {
        if (!Array.isArray(onlineIds)) return;
        const requestedIds = new Set(contactIds);
        setOnlineUserIds(new Set(onlineIds.filter((id): id is string =>
          typeof id === "string" && requestedIds.has(id)
        )));
      });
    }
    socket.on("presence:update", onPresenceUpdate);
    socket.on("connect", checkPresence);
    checkPresence();
    return () => {
      socket.off("presence:update", onPresenceUpdate);
      socket.off("connect", checkPresence);
    };
  }, [conversations, user?.id]);

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

  // Messages fetched from the server never pop in; only live arrivals do.
  const loadMessagesPage = async (id: string, cursor: string | null) => {
    const page = await fetchMessagesPage(id, cursor);
    for (const message of page.messages) knownMessageIdsRef.current.add(message.id);
    return page;
  };
  const messagesQuery = useInfiniteQuery({
    queryKey: ["messages", activeId],
    queryFn: ({ pageParam }) => loadMessagesPage(activeId!, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!activeId,
  });
  const messagePages = messagesQuery.data?.pages ?? [];
  const messages = [...messagePages].reverse().flatMap((page) => page.messages);
  const messagesLoaded = messagesQuery.isSuccess;
  const messagesFetching = messagesQuery.isFetching;
  const newestMessageId = messages[messages.length - 1]?.id ?? null;

  function warmChat(id: string) {
    void queryClient.prefetchInfiniteQuery({
      queryKey: ["messages", id],
      queryFn: ({ pageParam }) => loadMessagesPage(id, pageParam),
      initialPageParam: null as string | null,
      staleTime: 15_000,
    });
  }

  // The anchor is fixed once per chat, after fresh messages arrived, so later messages do not move it.
  useEffect(() => {
    if (!activeId) {
      unreadAnchorSetRef.current = null;
      setUnreadAnchorMessageId(null);
      return;
    }
    if (!messagesLoaded || messagesFetching || unreadCapturedId !== activeId || initialUnreadCount <= 0 || unreadAnchorSetRef.current === activeId) return;
    unreadAnchorSetRef.current = activeId;
    setUnreadAnchorMessageId(messages[Math.max(0, messages.length - initialUnreadCount)]?.id ?? null);
  }, [activeId, initialUnreadCount, messages, messagesFetching, messagesLoaded, unreadCapturedId]);

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
    if (distance <= 120) setNewBelowCount(0);
    if (container.scrollTop > 140) topAutoLoadReadyRef.current = true;
    if (container.scrollTop < 60 && topAutoLoadReadyRef.current) {
      topAutoLoadReadyRef.current = false;
      loadOlderMessages();
    }
  }

  function jumpToLatest() {
    messageScrollRef.current?.scrollTo({ top: messageScrollRef.current.scrollHeight, behavior: "smooth" });
    setNewBelowCount(0);
  }

  function setTypingState(conversationId: string, userId: string, typing: boolean) {
    const key = `${conversationId}:${userId}`;
    const existing = typingTimersRef.current.get(key);
    if (existing !== undefined) window.clearTimeout(existing);
    typingTimersRef.current.delete(key);
    const apply = (isTyping: boolean) => setTypingByConversation((current) => {
      const names = new Set(current[conversationId] ?? []);
      if (isTyping) names.add(userId);
      else names.delete(userId);
      const next = { ...current };
      if (names.size > 0) next[conversationId] = [...names];
      else delete next[conversationId];
      return next;
    });
    apply(typing);
    // A lost "stopped typing" event must not leave the indicator stuck.
    if (typing) typingTimersRef.current.set(key, window.setTimeout(() => { typingTimersRef.current.delete(key); apply(false); }, 6000));
  }

  function emitTyping(typing: boolean) {
    if (!activeId) return;
    getSocket().emit("typing", { conversationId: activeId, isTyping: typing });
    typingSentAtRef.current = typing ? Date.now() : 0;
  }

  function stopTyping() {
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (typingSentAtRef.current) emitTyping(false);
  }

  function onComposerInput(value: string) {
    if (!value.trim()) {
      stopTyping();
      return;
    }
    if (Date.now() - typingSentAtRef.current > 2500) emitTyping(true);
    if (typingStopTimerRef.current !== null) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(() => {
      typingStopTimerRef.current = null;
      emitTyping(false);
    }, 4000);
  }

  function closeChat() {
    if (chatClosing) return;
    setChatClosing(true);
    window.setTimeout(() => {
      setActiveId(null);
      setSearchParams({});
      setChatClosing(false);
    }, 170);
  }

  // Leaving a chat must not leave the other side staring at "typing…".
  useEffect(() => () => {
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (typingSentAtRef.current && activeId) getSocket().emit("typing", { conversationId: activeId, isTyping: false });
    typingSentAtRef.current = 0;
  }, [activeId]);

  useEffect(() => {
    if (!activeId || !messagesLoaded || !window.matchMedia("(pointer: fine)").matches) return;
    composerInputRef.current?.focus({ preventScroll: true });
  }, [activeId, messagesLoaded]);

  // Close the message menu on an outside tap or Escape.
  useEffect(() => {
    if (!actionMessageId) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-message-actions]")) return;
      setActionMessageId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionMessageId(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionMessageId]);

  // Sending always brings the new bubble into view, even when the reader scrolled up.
  const activePendingCount = pendingMessages.filter((pending) => pending.conversationId === activeId).length;
  useLayoutEffect(() => {
    const container = messageScrollRef.current;
    if (!container || activePendingCount === 0) return;
    wasAtBottomRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setNewBelowCount(0);
  }, [activePendingCount]);

  // Warm the two newest chats as soon as the list is known, so opening one is instant.
  useEffect(() => {
    if (!user || conversations.length === 0) return;
    const newest = [...conversations]
      .sort((a, b) => (b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0) - (a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0))
      .slice(0, 2);
    for (const conversation of newest) warmChat(conversation.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length, user?.id]);

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
      setUnreadCapturedId(null);
      return;
    }
    if (unreadCapturedId === activeId) return;
    const conversation = conversations.find((item) => item.id === activeId);
    if (!conversation) return;
    setInitialUnreadCount(conversation.unreadCount);
    setUnreadCapturedId(activeId);
  }, [activeId, conversations, unreadCapturedId]);
  const { data: encryptionKeys = [], isError: encryptionKeysError } = useQuery({
    queryKey: ["conversation-encryption-keys", activeId],
    queryFn: () => fetchEncryptionKeys(activeId!),
    enabled: !!activeId && deviceKeyReady,
  });
  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const canCall = !!activeConversation && activeConversation.members.length >= 2 && activeConversation.members.length <= MAX_LIVE_ROOM_PARTICIPANTS;
  const normalizedChatSearch = chatSearch.trim().replace(/^@/, "").toLocaleLowerCase();
  const pinnedSet = useMemo(() => new Set(pinnedChatIds), [pinnedChatIds]);
  const visibleConversations = useMemo(() => {
    const filtered = conversations.filter((conversation) => {
      if (chatFilter === "unread" && conversation.unreadCount === 0) return false;
      if (chatFilter === "groups" && !conversation.isGroup) return false;
      if (chatFilter === "pinned" && !pinnedSet.has(conversation.id)) return false;
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
      .map(({ message, parsed }) => parsed.kind === "voice" ? parsed.voice.mediaKey : parsed.kind === "text" && parsed.snapReply ? message.mediaKey ?? null : null)
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
    clearUnreadInCache(queryClient, activeId);
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
      const { message } = payload;
      const alreadyKnown = knownMessageIdsRef.current.has(message.id);
      if (message.senderId === user?.id) {
        // Our own message came back from the server: it replaces the oldest waiting bubble without a second pop.
        knownMessageIdsRef.current.add(message.id);
        if (!alreadyKnown) {
          setPendingMessages((current) => {
            const index = current.findIndex((pending) => pending.conversationId === payload.conversationId);
            return index === -1 ? current : current.filter((_, position) => position !== index);
          });
        }
      } else {
        setTypingState(payload.conversationId, message.senderId, false);
        if (payload.conversationId === activeId && !wasAtBottomRef.current) setNewBelowCount((count) => count + 1);
      }
      insertMessageIntoCache(queryClient, payload.conversationId, message);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (payload.conversationId === activeId && document.visibilityState === "visible") {
        clearUnreadInCache(queryClient, payload.conversationId);
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
    const onUpdatedMessage = (payload: { conversationId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["messages", payload.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    };
    socket.on("message:updated", onUpdatedMessage);
    function onTypingUpdate(payload: { conversationId?: unknown; userId?: unknown; isTyping?: unknown }) {
      if (typeof payload.conversationId !== "string" || typeof payload.userId !== "string" || typeof payload.isTyping !== "boolean") return;
      setTypingState(payload.conversationId, payload.userId, payload.isTyping);
    }
    socket.on("typing:update", onTypingUpdate);
    return () => {
      socket.off("message:new", onNewMessage);
      socket.off("message:updated", onUpdatedMessage);
      socket.off("typing:update", onTypingUpdate);
    };
  }, [activeId, queryClient, user?.id]);

  useEffect(() => () => {
    for (const timer of typingTimersRef.current.values()) window.clearTimeout(timer);
    typingTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!friendPickerOpen) return;
    friendSearchInputRef.current?.focus();
    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !friendPickerRef.current?.closest("form")?.contains(event.target)) {
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

  async function sendEncrypted(content: string, mediaKey?: string, storyId?: string) {
    if (!activeId || !deviceKeyReady) throw new Error("Encryption is not ready yet.");
    if (!allMembersHaveKeys) {
      throw new Error("Every participant must open Messages once before you can send an encrypted message.");
    }
    const encryptedPayload: EncryptedMessagePayload = await encryptMessage(content, encryptionKeys);
    const conversationId = activeId;
    const res = await apiFetch<{ message: ConversationMessage }>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ encryptedPayload, ...(mediaKey ? { mediaKey } : {}), ...(storyId ? { storyId } : {}) }),
    });
    // Show the confirmed message right away instead of waiting for the socket echo.
    if (res?.message?.id && !knownMessageIdsRef.current.has(res.message.id)) {
      knownMessageIdsRef.current.add(res.message.id);
      insertMessageIntoCache(queryClient, conversationId, res.message);
    }
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!messageText.trim() || !activeId || !deviceKeyReady) return;
    setMessageError(null);
    stopTyping();
    const keepKeyboard = sendKeepFocusRef.current || document.activeElement === composerInputRef.current;
    sendKeepFocusRef.current = false;
    const draft = messageText;
    const replyContext = storyReplyContext;
    const snapContext = snapReplyContext;
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
    setSnapReplyContext(null);
    setReplyTarget(null);
    if (keepKeyboard) composerInputRef.current?.focus({ preventScroll: true });
    try {
      let snapReply: SnapReplyContext | null = null;
      let snapPreviewKey: string | undefined;
      if (snapContext) {
        const preview = await createSnapReplyThumbnail(snapContext.image);
        const encryptedPreview = await encryptMediaBlob(preview, "snap-preview.bin", "image/jpeg");
        snapPreviewKey = await uploadMedia(encryptedPreview.file, { resize: false });
        snapReply = {
          snapId: snapContext.snapId,
          authorUsername: snapContext.authorUsername,
          createdAt: snapContext.createdAt,
          key: encryptedPreview.key,
          iv: encryptedPreview.iv,
        };
      }
      const messageContent = replyContext
        ? JSON.stringify({
            type: "story_reply",
            story: replyContext,
            text: wrappedReply,
          })
        : snapReply
          ? JSON.stringify({ type: "snap_reply", snap: snapReply, text: wrappedReply })
          : wrappedReply;
      await sendEncrypted(messageContent, snapPreviewKey, replyContext?.storyId);
      setPendingMessages((current) => current.filter((message) => message.id !== pendingId));
    } catch (error) {
      setPendingMessages((current) => current.filter((message) => message.id !== pendingId));
      setMessageText((current) => current || draft);
      setStoryReplyContext(replyContext);
      setSnapReplyContext(snapContext);
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
    replySwipeRef.current = { id: messageId, startX: event.clientX, startY: event.clientY, mode: null, el: event.currentTarget, armed: false };
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = window.setTimeout(() => {
      navigator.vibrate?.(12);
      setActionMessageId(messageId);
      releaseSwipe();
    }, 420);
  }

  function releaseSwipe() {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    const swipe = replySwipeRef.current;
    replySwipeRef.current = null;
    if (!swipe) return;
    const el = swipe.el;
    el.style.transition = "transform 240ms cubic-bezier(0.2, 0.9, 0.3, 1.2)";
    el.style.transform = "";
    el.style.setProperty("--swipe", "0");
    el.querySelector<HTMLElement>(".chat-swipe-reply")?.setAttribute("data-armed", "false");
    window.setTimeout(() => { el.style.transition = ""; }, 260);
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
    if (swipe.mode !== "x") return;
    // The bubble follows the finger with resistance; the icon shows when letting go will reply.
    const pull = Math.max(0, Math.min(deltaX, 110));
    swipe.el.style.transition = "none";
    swipe.el.style.transform = `translateX(${pull * 0.55}px)`;
    swipe.el.style.setProperty("--swipe", String(Math.min(1, pull / REPLY_SWIPE_THRESHOLD)));
    const armed = deltaX > REPLY_SWIPE_THRESHOLD;
    if (armed !== swipe.armed) {
      swipe.armed = armed;
      swipe.el.querySelector<HTMLElement>(".chat-swipe-reply")?.setAttribute("data-armed", String(armed));
      if (armed) navigator.vibrate?.(8);
    }
  }

  function onMessagePointerUp(messageId: string, senderUsername: string, text: string, event: React.PointerEvent<HTMLDivElement>) {
    const swipe = replySwipeRef.current;
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    releaseSwipe();
    if (!swipe || swipe.id !== messageId || swipe.mode !== "x") return;
    const deltaX = event.clientX - swipe.startX;
    if (deltaX > REPLY_SWIPE_THRESHOLD) {
      setReplyTarget({ id: messageId, senderUsername, text: text.trim().slice(0, 120) || "message" });
      composerInputRef.current?.focus();
    }
  }

  const typingIds = typingByConversation[activeId ?? ""] ?? [];
  const typingLabel = typingIds.length === 0 ? null : activeConversation?.isGroup
    ? `${typingIds.slice(0, 2).map((id) => `@${activeConversation.members.find((member) => member.id === id)?.username ?? "someone"}`).join(", ")} ${typingIds.length > 1 ? "are" : "is"} typing`
    : "typing";

  const renderedMessages = [
    ...visibleParsedMessages.map((entry) => ({ ...entry, pending: false })),
    ...visiblePendingMessages,
  ];

  return (
    <div className="chat-page mx-auto w-full max-w-7xl px-4 py-4 sm:py-6">
      <PullToRefresh enabled={!activeId && !call.activeCall && !call.incomingCall} onRefresh={async () => {
        const refreshes = [
          queryClient.invalidateQueries({ queryKey: ["conversations"] }),
          queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
        ];
        if (activeId) refreshes.push(queryClient.invalidateQueries({ queryKey: ["messages", activeId] }));
        await Promise.all(refreshes);
      }} />
      <PageHeader title="Chats" />
      <NavBar />
      {encryptionError && <p role="alert" className="mb-3 text-xs text-red-600">{encryptionError}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:items-start lg:gap-0">
        <div className={`w-full min-w-0 ${activeId ? "hidden lg:block" : ""}`}>
          <div role="tablist" aria-label="Messages view" className="mb-3 inline-flex max-w-full gap-1 border-b border-gray-200 pb-2">
            <button
              type="button"
              role="tab"
              aria-selected={messageView === "chats" || groupMode}
              onClick={() => {
                setMessageView("chats");
                setSelectedGroupUsernames([]);
              }}
              className={`min-h-9 rounded-full px-3 text-sm font-semibold transition-colors ${messageView === "chats" || groupMode ? "bg-emerald-50 text-emerald-800" : "text-gray-500 hover:text-gray-800"}`}
            >
              Chats
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={messageView === "live_rooms"}
              onClick={() => setMessageView("live_rooms")}
              className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${messageView === "live_rooms" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              <span className={hasJoinableLiveRoom ? "live-tab-pulse" : "live-tab-red"}>Live Rooms</span>
            </button>
          </div>
          {messageView !== "live_rooms" && (groupMode || friendPickerOpen) && <form
            onSubmit={(event) => {
              event.preventDefault();
              if (groupMode) void startGroup();
              else if (matchingFriends[0]) void startConversation(matchingFriends[0].username);
            }}
            className="mb-3 flex flex-col gap-3"
          >
            <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
              <button type="button" aria-pressed={!groupMode} onClick={() => { setMessageView("chats"); setSelectedGroupUsernames([]); setFriendPickerOpen(true); }} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold ${!groupMode ? "bg-emerald-50 text-emerald-800" : "text-gray-500"}`}>Direct message</button>
              <button type="button" aria-pressed={groupMode} onClick={() => { setMessageView("create_group"); setFriendPickerOpen(true); }} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold ${groupMode ? "bg-emerald-50 text-emerald-800" : "text-gray-500"}`}>New group</button>
              <button type="button" aria-label="Close new chat" className="list-icon-action" onClick={() => { setMessageView("chats"); setFriendPickerOpen(false); setSelectedGroupUsernames([]); }}>×</button>
            </div>
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
                    <div aria-hidden="true" className="space-y-3 px-3 py-3">
                      {[0, 1, 2].map((row) => (
                        <div key={row} className="flex items-center gap-3">
                          <span className="skeleton skeleton-round block h-9 w-9 shrink-0" />
                          <span className="block flex-1 space-y-2">
                            <span className="skeleton block h-3" style={{ width: `${44 + row * 14}%` }} />
                            <span className="skeleton block h-2.5 w-1/4" />
                          </span>
                        </div>
                      ))}
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
                  placeholder="Search"
                  type="search"
                  className="app-search min-w-0 flex-1"
                />
                <button
                  type="button"
                  aria-label="New chat"
                  title="New chat"
                  onClick={() => {
                    setFriendPickerOpen(true);
                    friendSearchInputRef.current?.focus();
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-2xl font-medium text-white transition-colors hover:bg-emerald-800"
                >
                  <span aria-hidden="true">+</span>
                </button>
              </div>
              <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setChatFilter("all")}
                  aria-pressed={chatFilter === "all"}
                  className={`chat-filter ${chatFilter === "all" ? "chat-filter-active" : ""}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter("unread")}
                  aria-pressed={chatFilter === "unread"}
                  className={`chat-filter ${chatFilter === "unread" ? "chat-filter-active" : ""}`}
                >
                  Unread
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter("groups")}
                  aria-pressed={chatFilter === "groups"}
                  className={`chat-filter ${chatFilter === "groups" ? "chat-filter-active" : ""}`}
                >
                  Groups
                </button>
                <button type="button" onClick={() => setChatFilter("pinned")} aria-pressed={chatFilter === "pinned"} className={`chat-filter ${chatFilter === "pinned" ? "chat-filter-active" : ""}`}>Pinned</button>
              </div>
            </div>
          )}
          {messageView === "chats" && <div aria-label="Chat list" className="chat-list lg:max-h-[calc(100dvh-19rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-3">
            {conversationsLoading && <ChatListSkeleton />}
            {conversationsFailed && <div role="alert" className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-red-600"><span>Could not load chats.</span><button type="button" onClick={() => void retryConversations()} className="min-h-11 shrink-0 px-2 font-semibold">Retry</button></div>}
            {visibleConversations.map((c, rowIndex) => (
              <div key={c.id} data-conversation-id={c.id} style={{ animationDelay: `${Math.min(rowIndex, 8) * 28}ms` }} className={`chat-list-row chat-list-row-press snap-row-enter ${activeId === c.id ? "chat-list-selected" : ""}`}>
                <button
                  type="button"
                  onPointerDown={() => warmChat(c.id)}
                  onMouseEnter={() => warmChat(c.id)}
                  onClick={() => setActiveId(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {c.isGroup ? (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                      {c.members.length}
                    </span>
                  ) : (
                    <span className={`relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white ${c.otherMember && onlineUserIds.has(c.otherMember.id) ? "ring-2 ring-emerald-500 ring-offset-1" : ""}`}>
                      <Avatar
                        avatarKey={c.otherMember?.avatarKey ?? null}
                        username={c.otherMember?.username ?? "?"}
                        size={c.otherMember && onlineUserIds.has(c.otherMember.id) ? 40 : 44}
                      />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className={`min-w-0 flex-1 truncate text-[16px] text-gray-900 ${c.unreadCount > 0 ? "font-bold" : "font-semibold"}`}>
                        {c.isGroup
                          ? c.name ?? c.members.map((member) => `@${member.username}`).join(", ")
                          : c.otherMember?.displayName || `@${c.otherMember?.username ?? "Unknown"}`}
                      </span>
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-2">
                      {typingByConversation[c.id]?.length ? (
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-green-600">typing<TypingDots /></span>
                      ) : (<>
                      {c.lastMessage?.isEncrypted && (
                        <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500">
                          <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                        </span>
                      )}
                      <span className={`min-w-0 flex-1 truncate text-[13px] leading-5 ${c.unreadCount > 0 ? "font-medium text-gray-800" : "text-gray-500"}`}>
                        {chatPreview(c.lastMessage)}
                      </span>
                      </>)}
                    </span>
                  </span>
                  <span className="flex w-14 shrink-0 flex-col items-end gap-1.5 self-center">
                    {c.lastMessage && (
                      <time dateTime={c.lastMessage.createdAt} className={`text-[11px] ${c.unreadCount > 0 ? "font-semibold text-green-600" : "text-gray-400"}`}>{formatActivityTime(c.lastMessage.createdAt)}</time>
                    )}
                    {c.unreadCount > 0 ? (
                        <span
                          key={c.unreadCount}
                          aria-label={`${c.unreadCount} unread messages`}
                          className="chat-badge-pop inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-green-600 px-1.5 text-[11px] font-bold text-white"
                        >
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </span>
                    ) : pinnedSet.has(c.id) ? <span className="text-[10px] text-gray-500">Pinned</span> : null}
                  </span>
                </button>
                <details className="relative shrink-0">
                  <summary aria-label="Chat actions" title="Chat actions" className="list-icon-action cursor-pointer list-none [&::-webkit-details-marker]:hidden"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg></summary>
                <button
                  type="button"
                  onClick={(event) => { togglePinnedChat(c.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}
                  aria-label={pinnedSet.has(c.id) ? "Unpin chat" : "Pin chat"}
                  aria-pressed={pinnedSet.has(c.id)}
                  title={pinnedSet.has(c.id) ? "Unpin chat" : "Pin chat"}
                  className="absolute right-0 top-full z-30 flex min-h-11 w-36 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3.5h8l-1 5 3 3v2h-5v6.5L12 22l-1-2v-6.5H6v-2l3-3-1-5Z" />
                  </svg>
                  {pinnedSet.has(c.id) ? "Unpin chat" : "Pin chat"}
                </button>
                </details>
              </div>
            ))}
            {visibleConversations.length === 0 && !conversationsLoading && !conversationsFailed && (
              <p className="px-4 py-6 text-center text-sm text-gray-500">{chatSearch ? "No chats found." : chatFilter === "all" ? "No conversations yet." : "No chats in this filter."}</p>
            )}
          </div>}
          {messageView === "chats" && (
            <p className="mt-4 flex items-center justify-center gap-1.5 px-4 text-center text-[11px] leading-5 text-gray-500">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3 w-3 shrink-0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              {deviceKeyReady ? "Your messages are end-to-end encrypted on this device." : "Preparing encrypted messaging for this device."}
            </p>
          )}
          {messageView === "live_rooms" && <LiveRoomsBar />}
        </div>

        {!activeId && <section aria-label="No chat selected" className="chat-empty hidden min-h-[34rem] flex-col items-center justify-center border-l border-gray-200 lg:flex">
          <span aria-hidden="true" className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-700 text-3xl font-semibold text-emerald-700">in</span>
          <h2 className="text-xl font-semibold text-gray-900">InTouch</h2>
          <p className="mt-2 text-sm text-gray-500">Chats</p>
        </section>}
        {activeId && (
          <section
            key={activeId}
            className={`chat-conversation fixed inset-x-0 top-0 z-[56] flex flex-col bg-gray-50 lg:relative lg:inset-auto lg:z-auto lg:h-[calc(100dvh-12rem)] lg:min-h-[34rem] lg:overflow-hidden lg:border-l lg:border-gray-200 ${chatClosing ? "chat-slide-out" : "chat-slide-in"}`}
            style={{ bottom: keyboardOffset }}
            aria-label="Conversation"
          >
            <div className="chat-conversation-header shrink-0 border-b border-gray-200 bg-white">
              <div className="mx-auto flex w-full max-w-2xl items-center gap-1.5 px-1.5 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:max-w-none lg:gap-2.5 lg:px-4 lg:pt-3">
                <button
                  type="button"
                  onClick={closeChat}
                  aria-label="Back to Messages"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-700 transition-[background-color,transform] hover:bg-gray-100 active:scale-90 lg:hidden"
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
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${onlineUserIds.has(activeConversation.otherMember.id) ? "ring-2 ring-emerald-500 ring-offset-1" : ""}`}>
                      <Avatar
                        avatarKey={activeConversation.otherMember.avatarKey}
                        username={activeConversation.otherMember.username}
                        size={onlineUserIds.has(activeConversation.otherMember.id) ? 36 : 40}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold leading-5 text-gray-900">
                        {activeConversation.otherMember.displayName || `@${activeConversation.otherMember.username}`}
                      </span>
                      <span className={`block truncate text-[11px] leading-4 ${typingLabel ? "font-medium text-green-600" : deviceKeyReady && allMembersHaveKeys && !encryptionKeysError ? "text-green-700" : "text-amber-700"}`}>
                        {typingLabel ? <>{typingLabel}<TypingDots /></> : deviceKeyReady && allMembersHaveKeys && !encryptionKeysError
                          ? `End-to-end encrypted${onlineUserIds.has(activeConversation.otherMember.id) ? " · Online now" : ""}`
                          : "Not ready for encryption yet"}
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
                  <p className={`truncate text-[11px] leading-4 ${typingLabel ? "font-medium text-green-600" : deviceKeyReady && allMembersHaveKeys && !encryptionKeysError ? "text-green-700" : "text-amber-700"}`}>
                    {typingLabel ? <>{typingLabel}<TypingDots /></> : deviceKeyReady && allMembersHaveKeys && !encryptionKeysError
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
              <div className="mx-auto flex w-full max-w-2xl items-center gap-2 overflow-x-auto border-b border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 sm:px-[max(0.75rem,calc((100%-42rem)/2))] lg:max-w-none lg:px-4">
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
            <div ref={messageScrollRef} onScroll={trackMessageScroll} style={conversationBackgroundStyle} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden overscroll-contain [overflow-anchor:none] px-3 py-3 sm:px-[max(0.75rem,calc((100%-42rem)/2))]">
              {messagesQuery.isPending && (
                <div aria-hidden="true" className="space-y-2 px-1 py-2">
                  <div className="skeleton h-14 w-2/3 rounded-lg" />
                  <div className="skeleton ml-auto h-10 w-1/2 rounded-lg" />
                  <div className="skeleton h-[4.5rem] w-3/4 rounded-lg" />
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
                if (parsed.kind === "call" && "callId" in message && message.callId) return (
                  <div key={message.id} className="my-2 self-center rounded-lg border border-gray-200 bg-white/90 px-4 py-2 text-center text-xs text-gray-600">
                    <span className="block font-semibold text-gray-800">{parsed.callType === "video" ? "Video call" : "Audio call"}</span>
                    <span>{parsed.status === "completed" ? `Duration ${formatDuration(parsed.durationSeconds * 1000)}`
                      : parsed.status === "missed" ? "Missed call" : parsed.status === "declined" ? "Declined call"
                      : parsed.status === "ongoing" ? "In progress" : "Ringing"}</span>
                    <time className="ml-2 text-gray-400">{formatClock(message.createdAt)}</time>
                  </div>
                );
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
                    onPointerCancel={releaseSwipe}
                    className={`chat-bubble ${startsGroup ? "mt-2" : ""} ${mine ? "chat-bubble-mine self-end" : "chat-bubble-theirs self-start"} ${isPending ? "opacity-75" : ""} ${isPending || !knownMessageIdsRef.current.has(message.id) ? "chat-bubble-pop" : ""} ${actionMessageId === message.id ? "chat-bubble-selected" : ""}`}
                  >
                    <span aria-hidden="true" className="chat-swipe-reply" data-armed="false">
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v3" /></svg>
                    </span>
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
                          src={mediaUrl(message.mediaKey ?? parsed.storyReply.imageKey)}
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
                    {parsed.kind === "text" && parsed.snapReply && message.mediaKey && (
                      <div
                        data-snap-id={parsed.snapReply.snapId}
                        className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg bg-black/5 p-1.5"
                      >
                        <EncryptedSnapThumbnail mediaKey={message.mediaKey} reply={parsed.snapReply} />
                        <span className="min-w-0 py-1">
                          <span className="block text-[11px] font-semibold">Snap reply</span>
                          <span className="block truncate text-xs opacity-80">
                            @{parsed.snapReply.authorUsername} · {formatActivityTime(parsed.snapReply.createdAt)}
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
                      <div key={messageReactions[message.id]} className="chat-badge-pop mt-1 inline-flex rounded-full bg-black/8 px-2 py-0.5 text-xs">
                        {messageReactions[message.id]}
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] leading-4 opacity-60">
                      {"isEncrypted" in message && !message.isEncrypted && <span className="font-semibold text-red-600">Not encrypted</span>}
                      {mine && (
                        <span role="img" aria-label={isPending ? "Pending" : labelForDeliveryState((message as ConversationMessage).deliveryState)} title={isPending ? "Pending" : labelForDeliveryState((message as ConversationMessage).deliveryState)} className={`inline-flex items-center font-semibold ${(message as ConversationMessage).deliveryState === "read" ? "text-sky-600" : "text-gray-500"}`}>
                          {isPending ? <span className="h-2.5 w-2.5 rounded-full border border-current" /> : <svg aria-hidden="true" viewBox="0 0 24 16" fill="none" className="h-3 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m2 8 4 4L16 2" />{["delivered", "read"].includes((message as ConversationMessage).deliveryState ?? "") && <path d="m10 10 2 2L22 2" />}</svg>}
                        </span>
                      )}
                      <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
                    </div>
                    {actionMessageId === message.id && (
                      <div data-message-actions className="chat-menu-pop mt-2 flex flex-wrap gap-1.5 rounded-xl border border-black/10 bg-white/95 p-1.5 text-xs text-gray-700 shadow-sm">
                        <div className="flex w-full justify-between gap-0.5 pb-0.5">
                          {REACTION_CHOICES.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              aria-label={`React ${emoji}`}
                              aria-pressed={messageReactions[message.id] === emoji}
                              onClick={() => {
                                setMessageReactions((current) => {
                                  const next = { ...current };
                                  if (current[message.id] === emoji) delete next[message.id];
                                  else next[message.id] = emoji;
                                  return next;
                                });
                                setActionMessageId(null);
                              }}
                              className={`flex h-9 w-9 items-center justify-center rounded-full text-xl transition-transform active:scale-75 ${messageReactions[message.id] === emoji ? "bg-green-100" : "hover:bg-gray-100"}`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
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
                      </div>
                    )}
                  </div>
                  </Fragment>
                );
              })}
              {renderedMessages.length === 0 && (
                <div className="flex flex-1 items-center justify-center px-6 py-12">
                  <p className="rounded-full bg-white/90 px-4 py-2 text-sm text-gray-500 shadow-sm">No messages yet. Say hi!</p>
                </div>
              )}
              {(showJumpToLatest || newBelowCount > 0) && (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  aria-label={newBelowCount > 0 ? `Jump to latest message, ${newBelowCount} new` : "Jump to latest message"}
                  className="chat-badge-pop sticky bottom-1 z-10 mt-1 flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-full border border-gray-200 bg-white text-gray-600 shadow-md transition-transform active:scale-90"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  {newBelowCount > 0 && (
                    <span aria-hidden="true" className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-green-600 px-1 text-[11px] font-bold text-white">{newBelowCount > 99 ? "99+" : newBelowCount}</span>
                  )}
                </button>
              )}
            </div>
            {messageError && <p role="alert" className="shrink-0 bg-red-50 px-4 py-1.5 text-xs text-red-700">{messageError}</p>}
            {storyReplyContext && (
              <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-3 border-t border-gray-200 bg-white p-2 lg:max-w-none lg:px-4">
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
            {snapReplyContext && (
              <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-3 border-t border-gray-200 bg-white p-2 lg:max-w-none lg:px-4">
                <LocalBlobImage blob={snapReplyContext.image} alt={`Snap from @${snapReplyContext.authorUsername}`} className="h-14 w-10 shrink-0 rounded object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-gray-800">Replying to Snap</span>
                  <span className="block truncate text-xs text-gray-500">@{snapReplyContext.authorUsername} · {formatActivityTime(snapReplyContext.createdAt)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSnapReplyContext(null)}
                  aria-label="Remove Snap reply context"
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
              <div className="mx-auto w-full max-w-2xl lg:max-w-none lg:px-2">
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
                      onComposerInput(e.target.value);
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
                      key="send"
                      type="submit"
                      aria-label="Send message"
                      disabled={!deviceKeyReady || !allMembersHaveKeys || voiceBusy}
                      onPointerDown={() => { sendKeepFocusRef.current = document.activeElement === composerInputRef.current; }}
                      onMouseDown={(event) => event.preventDefault()}
                      className="composer-btn-pop flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-700 text-white transition-transform hover:bg-green-800 active:scale-90 disabled:opacity-50"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12 20 4l-4 16-4.5-6.5L5 12Zm6.5 1.5L20 4" /></svg>
                    </button>
                  ) : (
                    <button
                      key="mic"
                      type="button"
                      onClick={() => void recorder.start()}
                      disabled={!deviceKeyReady || !allMembersHaveKeys}
                      aria-label="Record a voice message"
                      title="Voice message"
                      className="composer-btn-pop flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-700 text-white transition-transform hover:bg-green-800 active:scale-95 disabled:opacity-50"
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
    </div>
  );
}
