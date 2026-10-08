import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "@app/shared";
import { apiFetch } from "../../lib/api.js";
import { encryptSnap, getDeviceEncryptionKeys } from "../../lib/encryption.js";
import type { PublicEncryptionKey } from "../../lib/encryption.js";
import { registerDeviceEncryptionKey } from "../../lib/encryptionRegistration.js";
import { useAuth } from "../../auth/AuthContext.js";
import { audienceBody, PUBLIC_AUDIENCE } from "../../lib/circles.js";
import type { Audience } from "../../lib/circles.js";
import { resizeImageForUpload, uploadMedia } from "../../lib/upload.js";
import { btnPrimary, input } from "../../lib/ui.js";
import AudiencePicker from "../AudiencePicker.js";
import CameraCapture from "./CameraCapture.js";
import Avatar from "../Avatar.js";

type ShareTarget = "post" | "story" | "snap";

function ShareTargetButton({
  target,
  selected,
  onClick,
}: {
  target: ShareTarget;
  selected: boolean;
  onClick: () => void;
}) {
  const labels = { post: "Post", story: "Story", snap: "Snap" };
  const icons = {
    post: <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4zM8 9h8M8 13h5" /></svg>,
    story: <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="6" /></svg>,
    snap: <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 20c1-1 2.2-1.5 4-1.5s3 .5 4 1.5M6 17c1.5-.5 2.5-1.5 3-3V8a3 3 0 0 1 6 0v6c.5 1.5 1.5 2.5 3 3" /><path d="M4 15c1.5 0 2.5-.5 3-1.5M20 15c-1.5 0-2.5-.5-3-1.5" /></svg>,
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-[background-color,color,transform] active:scale-95 ${selected ? "bg-white text-black shadow-sm" : "text-white/65 hover:text-white"}`}
    >
      {icons[target]} {labels[target]}
    </button>
  );
}

export default function CameraStudio({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [target, setTarget] = useState<ShareTarget>("post");
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<Audience>(PUBLIC_AUDIENCE);
  const [friendSearch, setFriendSearch] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: friends = [] } = useQuery({
    queryKey: ["camera-following", user?.username],
    queryFn: async () => (await apiFetch<{ users: PublicUser[] }>(`/users/${user!.username}/following`)).users,
    enabled: !!user && target === "snap",
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const normalizedSearch = friendSearch.trim().replace(/^@/, "").toLocaleLowerCase();
  const matchingFriends = friends.filter((friend) =>
    !normalizedSearch || friend.username.toLocaleLowerCase().includes(normalizedSearch) ||
    friend.displayName?.toLocaleLowerCase().includes(normalizedSearch)
  );

  function closeStudio() {
    if (sending) return;
    setFile(null);
    setCaption("");
    setRecipients([]);
    setFriendSearch("");
    setMissingKeys([]);
    setError(null);
    onClose();
  }

  function capture(fileFromCamera: File) {
    setFile(fileFromCamera);
    setError(null);
  }

  async function share(allowUnencrypted = false) {
    if (!file || (target === "snap" && recipients.length === 0)) return;
    setSending(true);
    setError(null);
    setMissingKeys([]);
    try {
      const resized = await resizeImageForUpload(file);
      if (target === "snap") {
        if (!user) throw new Error("Sign in to send a Snap.");
        await registerDeviceEncryptionKey(user.id);
        const keyResponse = await apiFetch<{ keys: PublicEncryptionKey[] }>("/snaps/encryption-keys", {
          method: "POST",
          body: JSON.stringify({ recipientUsernames: recipients }),
        });
        const recipientIds = [user.id, ...friends.filter((friend) => recipients.includes(friend.username)).map((friend) => friend.id)];
        const keyedUsers = new Set(keyResponse.keys.map((key) => key.userId));
        const missing = recipientIds.filter((id) => !keyedUsers.has(id));
        if (missing.length && !allowUnencrypted) {
          setMissingKeys([
            ...friends.filter((friend) => missing.includes(friend.id)).map((friend) => `@${friend.username}`),
            ...(missing.includes(user.id) ? ["your device"] : []),
          ]);
          setSending(false);
          return;
        }
        if (allowUnencrypted) {
          const imageKey = await uploadMedia(resized);
          await apiFetch("/snaps", {
            method: "POST",
            body: JSON.stringify({ imageKey, text: caption.trim() || undefined, recipientUsernames: recipients }),
          });
        } else {
          const { encryptedImage, payload } = await encryptSnap(resized, caption, keyResponse.keys);
          const imageKey = await uploadMedia(encryptedImage, { resize: false });
          await apiFetch("/snaps", {
            method: "POST",
            body: JSON.stringify({ imageKey, encryptedPayload: payload, recipientUsernames: recipients }),
          });
        }
      } else {
        const imageKey = await uploadMedia(resized);
        if (target === "post") {
          await apiFetch("/posts", {
            method: "POST",
            body: JSON.stringify({ imageKey, text: caption.trim() || undefined, ...audienceBody(audience) }),
          });
        } else {
          await apiFetch("/stories", {
            method: "POST",
            body: JSON.stringify({ imageKey, text: caption.trim() || undefined, ...audienceBody(audience) }),
          });
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feed", "first"] }),
        queryClient.invalidateQueries({ queryKey: ["stories"] }),
        queryClient.invalidateQueries({ queryKey: ["snaps-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["snap-streaks"] }),
      ]);
      setFile(null);
      setCaption("");
      setRecipients([]);
      setFriendSearch("");
      setMissingKeys([]);
      setError(null);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? `${caught.message} · Try again.` : "Could not share this photo.");
    } finally {
      setSending(false);
    }
  }

  if (!file) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
        <CameraCapture onCaptured={capture} onClose={closeStudio} onPickFile={() => document.getElementById("camera-file-picker")?.click()} />
        <input
          id="camera-file-picker"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (selected) capture(selected);
          }}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0b0e] text-white">
      <header className="flex min-h-14 items-center justify-between border-b border-white/10 px-4 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={() => setFile(null)} disabled={sending} className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-white/75 hover:bg-white/10 disabled:opacity-40" aria-label="Retake photo">
          ‹
        </button>
        <h2 className="text-sm font-semibold">Share your moment</h2>
        <button type="button" onClick={closeStudio} disabled={sending} className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-white/75 hover:bg-white/10 disabled:opacity-40" aria-label="Close camera">
          ×
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
        <div className="relative mx-auto flex aspect-[4/5] max-h-[44vh] w-full max-w-sm items-center justify-center overflow-hidden rounded-3xl bg-black">
          {previewUrl && <img src={previewUrl} alt="Photo preview" className="h-full w-full object-contain" />}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />
        </div>

        <div className="mx-auto mt-4 w-full max-w-sm">
          <div className="rounded-2xl bg-white/10 p-1">
            <div role="tablist" aria-label="Share to" className="flex gap-1">
              {(["post", "story", "snap"] as const).map((option) => (
                <ShareTargetButton key={option} target={option} selected={target === option} onClick={() => { setTarget(option); setMissingKeys([]); }} />
              ))}
            </div>
          </div>

          {target !== "snap" ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <span className="shrink-0 text-xs font-medium text-white/65">Visible to</span>
              <AudiencePicker value={audience} onChange={setAudience} tone="dark" />
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
              <label htmlFor="camera-friend-search" className="mb-2 block text-xs font-semibold text-white/80">Send to</label>
              <input
                id="camera-friend-search"
                value={friendSearch}
                onChange={(event) => setFriendSearch(event.target.value)}
                placeholder="Search friends"
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-fuchsia-400 focus:outline-none"
              />
              <div className="mt-2 flex max-h-32 flex-wrap content-start gap-2 overflow-y-auto">
                {matchingFriends.map((friend) => {
                  const selected = recipients.includes(friend.username);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() => setRecipients((current) => current.includes(friend.username)
                        ? current.filter((name) => name !== friend.username)
                        : [...current, friend.username])}
                      aria-pressed={selected}
                      className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors ${selected ? "border-fuchsia-300 bg-fuchsia-500/20 text-white" : "border-white/15 text-white/75 hover:bg-white/10"}`}
                    >
                      <Avatar avatarKey={friend.avatarKey} username={friend.username} size={20} />
                      @{friend.username}
                    </button>
                  );
                })}
              </div>
              {recipients.length > 0 && <p className="mt-2 text-[11px] text-white/50">{recipients.length} selected · content stays end-to-end encrypted when all devices have keys</p>}
            </div>
          )}

          <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-white/65">
            Caption
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={target === "post" ? 2000 : 500}
              rows={2}
              placeholder="Add a caption…"
              className="resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-fuchsia-400 focus:outline-none"
            />
          </label>

          {missingKeys.length > 0 && (
            <div role="alert" className="mt-3 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
              <p className="font-semibold">Encryption keys missing: {missingKeys.join(", ")}</p>
              <p className="mt-1">Ask everyone to open InTouch once to enable encrypted Snaps, or continue without encryption.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setMissingKeys([])} className="min-h-9 rounded-xl border border-amber-100/25 px-2 font-semibold">Wait for keys</button>
                <button type="button" onClick={() => void share(true)} disabled={sending} className="min-h-9 rounded-xl bg-amber-200 px-2 font-semibold text-amber-950 disabled:opacity-50">Send unencrypted</button>
              </div>
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        </div>
      </main>

      <footer className="border-t border-white/10 bg-[#0b0b0e]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-lg">
        <button
          type="button"
          onClick={() => void share()}
          disabled={sending || (target === "snap" && recipients.length === 0)}
          className="mx-auto flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-full bg-fuchsia-600 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-950/30 transition-[background-color,transform] hover:bg-fuchsia-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 4.5 4.5L19 7" />
            </svg>
          )}
          {sending ? "Sharing…" : target === "post" ? "Post photo" : target === "story" ? "Share story" : "Send Snap"}
        </button>
      </footer>
    </div>
  );
}
