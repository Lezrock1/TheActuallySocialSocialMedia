import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConversationMessage, ConversationSummary } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { getSocket } from "../lib/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import Avatar from "../components/Avatar.js";
import { card, input, btnPrimary, btnSecondary } from "../lib/ui.js";

async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await apiFetch<{ conversations: ConversationSummary[] }>(
    "/conversations"
  );
  return res.conversations;
}

async function fetchMessages(id: string): Promise<ConversationMessage[]> {
  const res = await apiFetch<{ messages: ConversationMessage[] }>(
    `/conversations/${id}/messages`
  );
  return res.messages;
}

export default function DMsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [messageText, setMessageText] = useState("");
  const [groupMode, setGroupMode] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupUsernames, setGroupUsernames] = useState("");

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", activeId],
    queryFn: () => fetchMessages(activeId!),
    enabled: !!activeId,
  });

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
    }
    socket.on("message:new", onNewMessage);
    return () => {
      socket.off("message:new", onNewMessage);
    };
  }, [queryClient]);

  async function startConversation(e: FormEvent) {
    e.preventDefault();
    if (!newUsername.trim()) return;
    const res = await apiFetch<{ conversationId: string }>("/conversations", {
      method: "POST",
      body: JSON.stringify({ username: newUsername.trim() }),
    });
    setNewUsername("");
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    setActiveId(res.conversationId);
  }

  async function startGroup(e: FormEvent) {
    e.preventDefault();
    const usernames = groupUsernames
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (usernames.length === 0) return;
    const res = await apiFetch<{ conversationId: string }>("/conversations/group", {
      method: "POST",
      body: JSON.stringify({ name: groupName || undefined, usernames }),
    });
    setGroupName("");
    setGroupUsernames("");
    setGroupMode(false);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    setActiveId(res.conversationId);
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!messageText.trim() || !activeId) return;
    await apiFetch(`/conversations/${activeId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: messageText }),
    });
    setMessageText("");
    // no manual cache update here - the "message:new" socket event (received
    // by the sender too) appends it to avoid double-inserting the message
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader title="Nachrichten" />
      <NavBar />
      <p className="mb-4 text-xs text-gray-400">
        Hinweis: Nachrichten sind serverseitig gespeichert, aktuell noch ohne Ende-zu-Ende-Verschlüsselung.
      </p>

      <div className="flex gap-6">
        <div className="w-1/3">
          <div className="mb-2 flex gap-3 text-xs">
            <button
              onClick={() => setGroupMode(false)}
              className={!groupMode ? "font-semibold text-black underline" : "text-gray-400"}
            >
              1:1
            </button>
            <button
              onClick={() => setGroupMode(true)}
              className={groupMode ? "font-semibold text-black underline" : "text-gray-400"}
            >
              Gruppe
            </button>
          </div>
          {!groupMode && (
            <form onSubmit={(e) => void startConversation(e)} className="mb-3 flex gap-1">
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Nutzername"
                className={`${input} w-full`}
              />
              <button className={btnSecondary}>+</button>
            </form>
          )}
          {groupMode && (
            <form onSubmit={(e) => void startGroup(e)} className="mb-3 flex flex-col gap-1">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Gruppenname (optional)"
                className={input}
              />
              <input
                value={groupUsernames}
                onChange={(e) => setGroupUsernames(e.target.value)}
                placeholder="Nutzernamen, mit Komma getrennt"
                className={input}
              />
              <button className={btnSecondary}>Gruppe erstellen</button>
            </form>
          )}
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
                    <p className="truncate text-xs text-gray-400">
                      {c.lastMessage.text}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1">
          {!activeId && <p className="text-sm text-gray-400">Konversation auswählen.</p>}
          {activeId && (
            <>
              <div className={`${card} mb-3 flex max-h-96 flex-col gap-2 overflow-y-auto`}>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
                      m.senderId === user?.id
                        ? "self-end bg-black text-white"
                        : "self-start bg-gray-100"
                    }`}
                  >
                    {m.text}
                  </div>
                ))}
                {messages.length === 0 && (
                  <p className="text-xs text-gray-400">Noch keine Nachrichten.</p>
                )}
              </div>
              <form onSubmit={(e) => void sendMessage(e)} className="flex gap-2">
                <input
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Nachricht…"
                  className={`${input} w-full`}
                />
                <button className={btnPrimary}>Senden</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
