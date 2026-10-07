import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_LIVE_ROOM_PARTICIPANTS } from "@app/shared";
import type { ConversationMessage, ConversationSummary, PublicUser } from "@app/shared";
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
import { mediaUrl } from "../lib/upload.js";
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

interface StoryReplyContext {
  storyId: string;
  imageKey: string;
  authorUsername: string;
  createdAt: string;
}

interface DecryptedMessageContent {
  text: string;
  storyReply?: StoryReplyContext;
}

function parseDecryptedMessage(content: string): DecryptedMessageContent {
  try {
    const value = JSON.parse(content) as {
      type?: unknown;
      text?: unknown;
      story?: Partial<StoryReplyContext>;
    };
    if (
      value.type === "story_reply" &&
      typeof value.text === "string" &&
      typeof value.story?.storyId === "string" &&
      typeof value.story.imageKey === "string" &&
      typeof value.story.authorUsername === "string"
    ) {
      return {
        text: value.text,
        storyReply: {
          storyId: value.story.storyId,
          imageKey: value.story.imageKey,
          authorUsername: value.story.authorUsername,
          createdAt: typeof value.story.createdAt === "string" ? value.story.createdAt : "",
        },
      };
    }
  } catch {
    // Ordinary messages are plain text rather than structured JSON.
  }
  return { text: content };
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

async function fetchMessages(id: string): Promise<ConversationMessage[]> {
  const res = await apiFetch<{ messages: ConversationMessage[] }>(
    `/conversations/${id}/messages`
  );
  return res.messages;
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

  const { data: messages = [], isSuccess: messagesLoaded } = useQuery({
    queryKey: ["messages", activeId],
    queryFn: () => fetchMessages(activeId!),
    enabled: !!activeId,
  });
  useLayoutEffect(() => {
    if (!activeId || !messagesLoaded || !messageScrollRef.current) return;
    const container = messageScrollRef.current;
    if (scrolledConversationRef.current !== activeId) {
      container.scrollTop = container.scrollHeight;
      scrolledConversationRef.current = activeId;
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [activeId, decryptedMessages, messages, messagesLoaded]);
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
      queryClient.setQueryData<ConversationMessage[]>(
        ["messages", payload.conversationId],
        (prev) => (prev ? [...prev, payload.message] : prev)
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

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!messageText.trim() || !activeId || !deviceKeyReady) return;
    setMessageError(null);
    try {
      if (!allMembersHaveKeys) {
        throw new Error("Every participant must open Messages once before you can send an encrypted message.");
      }
      const messageContent = storyReplyContext
        ? JSON.stringify({
            type: "story_reply",
            story: storyReplyContext,
            text: messageText.trim(),
          })
        : messageText.trim();
      const encryptedPayload: EncryptedMessagePayload = await encryptMessage(messageContent, encryptionKeys);
      await apiFetch(`/conversations/${activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({ encryptedPayload }),
      });
      setMessageText("");
      setStoryReplyContext(null);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Could not encrypt this message");
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
                The server distributes public keys. Compare these fingerprints with each participant through another trusted channel; otherwise a malicious server could substitute a key.
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
              {messages.map((message) => {
                const content = message.isEncrypted
                  ? decryptedMessages[message.id] ?? "Decrypting message..."
                  : message.text ?? "";
                const parsed = parseDecryptedMessage(content);
                return (
                  <div
                    key={message.id}
                    className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${
                      message.senderId === user?.id
                        ? "self-end bg-black text-white"
                        : "self-start bg-gray-100"
                    }`}
                  >
                    {parsed.storyReply && (
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
                    <p className="whitespace-pre-wrap">{parsed.text}</p>
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
              <form onSubmit={(e) => void sendMessage(e)} className="flex items-center gap-2">
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
                  placeholder="Message..."
                  className={`${input} min-w-0 flex-1`}
                />
                <button
                  disabled={!deviceKeyReady || !allMembersHaveKeys}
                  className={`${btnPrimary} min-h-10 shrink-0 bg-green-700 hover:bg-green-800 focus-visible:ring-green-700/20 disabled:opacity-50`}
                >Send</button>
              </form>
            </div>
          </section>
        )}
      </div>
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
