import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboxSnap, PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import Avatar from "../components/Avatar.js";
import { card } from "../lib/ui.js";

async function fetchInbox(): Promise<InboxSnap[]> {
  const res = await apiFetch<{ snaps: InboxSnap[] }>("/snaps/inbox");
  return res.snaps;
}

async function fetchFollowing(username: string): Promise<PublicUser[]> {
  const res = await apiFetch<{ users: PublicUser[] }>(`/users/${username}/following`);
  return res.users;
}

export default function SnapsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<InboxSnap | null>(null);

  const { data: snaps = [] } = useQuery({
    queryKey: ["snaps-inbox"],
    queryFn: fetchInbox,
  });
  const { data: following = [] } = useQuery({
    queryKey: ["following", user?.username],
    queryFn: () => fetchFollowing(user!.username),
    enabled: !!user,
  });

  function toggleRecipient(username: string) {
    setSelectedRecipients((prev) =>
      prev.includes(username) ? prev.filter((u) => u !== username) : [...prev, username]
    );
  }

  async function onSend(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || selectedRecipients.length === 0) return;
    setSending(true);
    try {
      const imageKey = await uploadMedia(file);
      await apiFetch("/snaps", {
        method: "POST",
        body: JSON.stringify({
          imageKey,
          text: text || undefined,
          recipientUsernames: selectedRecipients,
        }),
      });
      setText("");
      setSelectedRecipients([]);
    } finally {
      setSending(false);
    }
  }

  async function openSnap(snap: InboxSnap) {
    setViewing(snap);
    if (!snap.viewedAt) {
      await apiFetch(`/snaps/${snap.id}/view`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["snaps-inbox"] });
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader title="Snaps" />
      <NavBar />

      <div className={`${card} mb-6`}>
        <p className="mb-3 text-sm font-medium text-gray-700">An wen?</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {following.map((u) => {
            const isSelected = selectedRecipients.includes(u.username);
            return (
              <button
                key={u.id}
                onClick={() => toggleRecipient(u.username)}
                className={`flex flex-col items-center gap-1 rounded-lg p-1.5 transition ${
                  isSelected ? "bg-yellow-100 ring-2 ring-yellow-400" : "hover:bg-gray-50"
                }`}
              >
                <Avatar avatarKey={u.avatarKey} username={u.username} size={48} />
                <span className="max-w-[56px] truncate text-[11px]">@{u.username}</span>
              </button>
            );
          })}
          {following.length === 0 && (
            <p className="text-xs text-gray-400">Folge jemandem, um ihm Snaps zu senden.</p>
          )}
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Text hinzufügen (optional)"
          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="flex justify-center">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || selectedRecipients.length === 0}
            title="Snap aufnehmen und senden"
            className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-gray-200 bg-[#FFFC00] text-xs font-semibold text-black shadow-md transition hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
          >
            {sending ? "…" : "Senden"}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onSend(e)}
        />
      </div>

      <p className="mb-2 text-sm font-medium text-gray-700">Erhaltene Snaps</p>
      <div className="flex flex-col gap-2">
        {snaps.map((snap) => (
          <button
            key={snap.id}
            onClick={() => void openSnap(snap)}
            className={`${card} flex items-center gap-3 text-left`}
          >
            <span
              className={`rounded-full p-0.5 ${
                snap.viewedAt ? "" : "bg-gradient-to-br from-yellow-300 to-yellow-500"
              }`}
            >
              <Avatar avatarKey={snap.sender.avatarKey} username={snap.sender.username} size={44} />
            </span>
            <div>
              <p className={`text-sm ${snap.viewedAt ? "text-gray-500" : "font-semibold"}`}>
                @{snap.sender.username}
              </p>
              <p className="text-xs text-gray-400">
                {snap.viewedAt ? "Geöffnet" : "Neuer Snap"}
              </p>
            </div>
          </button>
        ))}
        {snaps.length === 0 && (
          <p className="text-sm text-gray-400">Keine neuen Snaps.</p>
        )}
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black"
          onClick={() => setViewing(null)}
        >
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4 text-white">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Avatar avatarKey={viewing.sender.avatarKey} username={viewing.sender.username} size={28} />
              @{viewing.sender.username}
            </span>
            <button onClick={() => setViewing(null)} className="text-2xl leading-none">
              ×
            </button>
          </div>
          <img
            src={mediaUrl(viewing.imageKey)}
            alt=""
            className="max-h-screen max-w-full object-contain"
          />
          {viewing.text && (
            <p className="absolute bottom-10 rounded-full bg-black/50 px-4 py-2 text-center text-white">
              {viewing.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
