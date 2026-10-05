import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { getSocket } from "../lib/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import Avatar from "../components/Avatar.js";
import EncryptionNotice from "../components/EncryptionNotice.js";
import { card, input, btnPrimary, btnSecondary } from "../lib/ui.js";

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
  const queryClient = useQueryClient();
  const friendPickerRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get("conversation"));
  const [friendSearch, setFriendSearch] = useState("");
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [selectedGroupUsernames, setSelectedGroupUsernames] = useState<string[]>([]);
  const [startingConversation, setStartingConversation] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [groupMode, setGroupMode] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [deviceKeyReady, setDeviceKeyReady] = useState(false);
  const [encryptionError, setEncryptionError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [decryptedMessages, setDecryptedMessages] = useState<Record<string, string>>({});

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
  const { data: encryptionKeys = [], isError: encryptionKeysError } = useQuery({
    queryKey: ["conversation-encryption-keys", activeId],
    queryFn: () => fetchEncryptionKeys(activeId!),
    enabled: !!activeId && deviceKeyReady,
  });
  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const membersWithKeys = new Set(encryptionKeys.map((key) => key.userId));
  const allMembersHaveKeys = !!activeConversation &&
    activeConversation.members.length > 0 &&
    activeConversation.members.every((member) => membersWithKeys.has(member.id));

  useEffect(() => {
    if (!activeId || !messagesLoaded) return;
    void markConversationRead(activeId)
      .then(() => Promise.all([
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
    setGroupMode(false);
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
      const encryptedPayload: EncryptedMessagePayload = await encryptMessage(
        messageText.trim(),
        encryptionKeys
      );
      await apiFetch(`/conversations/${activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({ encryptedPayload }),
      });
      setMessageText("");
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Could not encrypt this message");
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-4 sm:py-8">
      <PageHeader title="Messages" />
      <NavBar />
      <p className="mb-1 text-xs text-gray-500">
        {deviceKeyReady ? "This device is ready for encrypted messages." : "Setting up message encryption..."}
      </p>
      <p className="mb-4 mt-1 text-[11px] text-red-600">
        Older messages may still be stored as plaintext. Device keys stay in this browser; clearing its data can make encrypted history unreadable.
      </p>
      {encryptionError && <p role="alert" className="mb-3 text-xs text-red-600">{encryptionError}</p>}

      <div className="flex flex-col gap-6">
        {!activeId && <div className="w-full">
          <div className="mb-2 flex gap-3 text-xs">
            <button
              onClick={() => {
                setGroupMode(false);
                setSelectedGroupUsernames([]);
              }}
              className={!groupMode ? "font-semibold text-black underline" : "text-gray-400"}
            >
              1:1
            </button>
            <button
              onClick={() => setGroupMode(true)}
              className={groupMode ? "font-semibold text-black underline" : "text-gray-400"}
            >
              Group
            </button>
          </div>
          <form
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
                    <p className="px-3 py-3 text-sm text-gray-500">Loading friends...</p>
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
                Create group
              </button>
            )}
            {!groupMode && friendSearch.trim() && matchingFriends.length > 0 && (
              <button type="submit" disabled={startingConversation} className={`${btnSecondary} self-start`}>
                {startingConversation ? "Opening..." : `Message @${matchingFriends[0].username}`}
              </button>
            )}
          </form>
          <div className="flex flex-col gap-2">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`${card} flex items-center gap-2 text-left ${
                  activeId === c.id ? "ring-2 ring-black" : ""
                }`}
              >
                {c.isGroup ? (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-semibold text-white">
                    {c.members.length}
                  </span>
                ) : (
                  <Avatar
                    avatarKey={c.otherMember?.avatarKey ?? null}
                    username={c.otherMember?.username ?? "?"}
                    size={36}
                  />
                )}
                <div className="min-w-0">
                  {c.isGroup ? (
                    <span className="text-sm font-medium">
                      {c.name ?? c.members.map((m) => `@${m.username}`).join(", ")}
                    </span>
                  ) : (
                    <Link
                      to={`/u/${c.otherMember?.username}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-medium hover:underline"
                    >
                      @{c.otherMember?.username}
                    </Link>
                  )}
                  {c.lastMessage && (
                    <div className="mt-1">
                      <p className="truncate text-xs text-gray-500">
                        {c.lastMessage.isEncrypted ? "Encrypted message" : c.lastMessage.text}
                      </p>
                      <EncryptionNotice encrypted={c.lastMessage.isEncrypted}>
                        {c.lastMessage.isEncrypted ? "End-to-end encrypted" : "Not end-to-end encrypted"}
                      </EncryptionNotice>
                    </div>
                  )}
                </div>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="py-3 text-sm text-gray-400">No conversations yet.</p>
            )}
          </div>
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
            <div className={`${card} mb-3 flex max-h-[55vh] min-h-40 flex-col gap-2 overflow-y-auto`}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${
                    message.senderId === user?.id
                      ? "self-end bg-black text-white"
                      : "self-start bg-gray-100"
                  }`}
                >
                  <p>{message.isEncrypted
                    ? decryptedMessages[message.id] ?? "Decrypting message..."
                    : message.text}</p>
                  <EncryptionNotice encrypted={message.isEncrypted}>
                    {message.isEncrypted ? "End-to-end encrypted" : "Not end-to-end encrypted"}
                  </EncryptionNotice>
                </div>
              ))}
              {messages.length === 0 && (
                <p className="text-xs text-gray-400">No messages yet.</p>
              )}
            </div>
            {messageError && <p role="alert" className="mb-2 text-xs text-red-600">{messageError}</p>}
            <form onSubmit={(e) => void sendMessage(e)} className="flex items-center gap-2">
              <input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Message..."
                className={`${input} min-w-0 flex-1`}
              />
              <button
                disabled={!deviceKeyReady || !allMembersHaveKeys}
                className={`${btnPrimary} min-h-10 shrink-0 disabled:opacity-50`}
              >Send</button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
