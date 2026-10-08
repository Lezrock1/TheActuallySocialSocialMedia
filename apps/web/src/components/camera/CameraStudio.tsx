import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "@app/shared";
import { apiFetch } from "../../lib/api.js";
import { encryptSnap, getDeviceEncryptionKeys } from "../../lib/encryption.js";
import type { PublicEncryptionKey } from "../../lib/encryption.js";
import { registerDeviceEncryptionKey } from "../../lib/encryptionRegistration.js";
import { useAuth } from "../../auth/AuthContext.js";
import { useThemePreference } from "../../lib/theme.js";
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
  dark,
  onClick,
}: {
  target: ShareTarget;
  selected: boolean;
  dark: boolean;
  onClick: () => void;
}) {
  const labels = { post: "Post", story: "Story", snap: "Snap" };
  const icons = {
    post: <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4zM8 9h8M8 13h5" /></svg>,
    story: <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="6" /></svg>,
    snap: <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13.2 4.2c2.1-1.3 5.2-1.4 6.4-1.4 0 1.2-.1 4.3-1.4 6.4L12 15.4l-3.4-3.4 4.6-7.8Z" /><circle cx="15.3" cy="7.6" r="1.4" /><path d="m8.6 12-3.1.5-2.2 2.2 5.2.7m3.1-3.1-.5 3.1-2.2 2.2-.7-5.2M5.3 18.7c-.7.7-.7 1.8-.7 1.8s1.1 0 1.8-.7" /></svg>,
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-[background-color,color,transform] active:scale-95 ${selected ? (dark ? "bg-white text-black shadow-sm" : "bg-white text-gray-900 shadow-sm") : (dark ? "text-white/65 hover:text-white" : "text-gray-500 hover:text-gray-900")}`}
    >
      {icons[target]} {labels[target]}
    </button>
  );
}

export default function CameraStudio({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [theme] = useThemePreference();
  const dark = theme === "dark";
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
    <div className={`fixed inset-0 z-[60] flex flex-col ${dark ? "bg-[#0b0b0e] text-white" : "bg-[#f7f7f8] text-gray-900"}`}>
      <header className={`flex min-h-14 items-center justify-between border-b px-4 pt-[env(safe-area-inset-top)] ${dark ? "border-white/10" : "border-gray-200 bg-white"}`}>
        <button type="button" onClick={() => setFile(null)} disabled={sending} className={`flex h-10 w-10 items-center justify-center rounded-full text-xl disabled:opacity-40 ${dark ? "text-white/75 hover:bg-white/10" : "text-gray-600 hover:bg-gray-100"}`} aria-label="Retake photo">
          ‹
        </button>
        <h2 className="text-sm font-semibold">Share your moment</h2>
        <button type="button" onClick={closeStudio} disabled={sending} className={`flex h-10 w-10 items-center justify-center rounded-full text-xl disabled:opacity-40 ${dark ? "text-white/75 hover:bg-white/10" : "text-gray-600 hover:bg-gray-100"}`} aria-label="Close camera">
          ×
        </button>
      </header>

      <main className={`min-h-0 flex-1 px-4 pb-3 pt-3 ${target === "snap" ? "snap-share-enter flex flex-col overflow-y-auto" : "overflow-y-auto"}`}>
        <div className={`relative mx-auto flex w-full shrink-0 items-center justify-center overflow-hidden rounded-3xl ${dark ? "bg-black" : "bg-gray-200"} ${target === "snap" ? "aspect-[4/3] max-h-[18vh] max-w-xl" : "aspect-[4/5] max-h-[44vh] max-w-sm"}`}>
          {previewUrl && <img src={previewUrl} alt="Photo preview" className="h-full w-full object-contain" />}
          <span className={`pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t ${dark ? "from-black/50" : "from-black/25"} to-transparent`} />
        </div>

        <div className={`mx-auto mt-4 w-full ${target === "snap" ? "max-w-2xl" : "max-w-sm"}`}>
          <div className={`shrink-0 rounded-2xl p-1 ${dark ? "bg-white/10" : "bg-gray-200"}`}>
            <div role="tablist" aria-label="Share to" className="flex gap-1">
              {(["post", "story", "snap"] as const).map((option) => (
                <ShareTargetButton key={option} target={option} selected={target === option} dark={dark} onClick={() => { setTarget(option); setMissingKeys([]); }} />
              ))}
            </div>
          </div>

          {target !== "snap" ? (
            <div className={`mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
              <span className={`shrink-0 text-xs font-medium ${dark ? "text-white/65" : "text-gray-500"}`}>Visible to</span>
              <AudiencePicker value={audience} onChange={setAudience} tone="dark" />
            </div>
          ) : (
            <>
              <label className={`mt-3 flex flex-col gap-1 text-xs font-medium ${dark ? "text-white/65" : "text-gray-600"}`}>
                Caption
                <textarea
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Add a caption…"
                  className={`resize-none rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-4 ${dark ? "border-white/15 bg-white/5 text-white placeholder:text-white/35 focus:border-fuchsia-400 focus:ring-fuchsia-400/15" : "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-fuchsia-500 focus:ring-fuchsia-500/10"}`}
                />
              </label>
              <div className={`mt-3 flex flex-col rounded-2xl border p-3 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white shadow-sm"}`}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="camera-friend-search" className={`text-xs font-semibold ${dark ? "text-white/80" : "text-gray-700"}`}>Send to</label>
                <span className={`text-[11px] tabular-nums ${dark ? "text-white/55" : "text-gray-500"}`}>{recipients.length} selected</span>
              </div>
              <input
                id="camera-friend-search"
                value={friendSearch}
                onChange={(event) => setFriendSearch(event.target.value)}
                placeholder="Search friends"
                className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-4 ${dark ? "border-white/15 bg-black/30 text-white placeholder:text-white/40 focus:border-fuchsia-400 focus:ring-fuchsia-400/15" : "border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus:border-fuchsia-500 focus:ring-fuchsia-500/10"}`}
              />
              <div aria-label="Friends" role="listbox" aria-multiselectable="true" className={`mt-2 divide-y rounded-xl border ${dark ? "divide-white/10 border-white/10 bg-black/20" : "divide-gray-100 border-gray-100 bg-white"}`}>
                {matchingFriends.map((friend) => {
                  const selected = recipients.includes(friend.username);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      role="option"
                      onClick={() => setRecipients((current) => current.includes(friend.username)
                        ? current.filter((name) => name !== friend.username)
                        : [...current, friend.username])}
                      aria-pressed={selected}
                      aria-selected={selected}
                      className={`flex min-h-[58px] w-full items-center gap-3 px-3 text-left transition-colors ${selected ? (dark ? "bg-fuchsia-500/15" : "bg-fuchsia-50") : (dark ? "hover:bg-white/5" : "hover:bg-gray-50")}`}
                    >
                      <Avatar avatarKey={friend.avatarKey} username={friend.username} size={38} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${dark ? "text-white" : "text-gray-900"}`}>{friend.displayName || `@${friend.username}`}</span>
                        <span className={`block truncate text-xs ${dark ? "text-white/50" : "text-gray-500"}`}>@{friend.username}</span>
                      </span>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] transition-colors ${selected ? "border-fuchsia-500 bg-fuchsia-600 text-white" : (dark ? "border-white/35 text-transparent" : "border-gray-300 text-transparent")}`}>✓</span>
                    </button>
                  );
                })}
                {matchingFriends.length === 0 && (
                  <p className={`px-3 py-4 text-center text-xs ${dark ? "text-white/55" : "text-gray-500"}`}>
                    {friends.length === 0 ? "Follow someone first to send a Snap." : "No friends match that search."}
                  </p>
                )}
              </div>
              <p className={`mt-2 shrink-0 text-[10px] leading-4 ${dark ? "text-white/45" : "text-gray-500"}`}>Encrypted on this device when every recipient has registered a key.</p>
              </div>
            </>
          )}

          {target !== "snap" && <label className={`mt-3 flex flex-col gap-1 text-xs font-medium ${dark ? "text-white/65" : "text-gray-600"}`}>
            Caption
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={target === "post" ? 2000 : 500}
              rows={2}
              placeholder="Add a caption…"
              className={`resize-none rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-4 ${dark ? "border-white/15 bg-white/5 text-white placeholder:text-white/35 focus:border-fuchsia-400 focus:ring-fuchsia-400/15" : "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-fuchsia-500 focus:ring-fuchsia-500/10"}`}
            />
          </label>}

          {missingKeys.length > 0 && (
            <div role="alert" className={`mt-3 shrink-0 rounded-2xl border p-3 text-xs leading-5 ${dark ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              <p className="font-semibold">Encryption keys missing: {missingKeys.join(", ")}</p>
              <p className="mt-1">Ask everyone to open InTouch once to enable encrypted Snaps, or continue without encryption.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setMissingKeys([])} className={`min-h-9 rounded-xl border px-2 font-semibold ${dark ? "border-amber-100/25" : "border-amber-300 bg-white"}`}>Wait for keys</button>
                <button type="button" onClick={() => void share(true)} disabled={sending} className="min-h-9 rounded-xl bg-amber-300 px-2 font-semibold text-amber-950 disabled:opacity-50">Send unencrypted</button>
              </div>
            </div>
          )}
          {error && <p role="alert" className={`mt-3 shrink-0 text-sm ${dark ? "text-red-300" : "text-red-700"}`}>{error}</p>}
        </div>
      </main>

      <footer className={`border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 ${dark ? "border-white/10 bg-[#0b0b0e]/95" : "border-gray-200 bg-white/95"} backdrop-blur-lg`}>
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
