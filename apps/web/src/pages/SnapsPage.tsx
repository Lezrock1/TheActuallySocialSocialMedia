import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboxSnap, PublicUser, SnapStreakSummary } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { downloadMediaBlob, uploadMedia } from "../lib/upload.js";
import {
  decryptSnap,
  encryptSnap,
  getDeviceEncryptionKeys,
} from "../lib/encryption.js";
import type { PublicEncryptionKey } from "../lib/encryption.js";
import { registerDeviceEncryptionKey } from "../lib/encryptionRegistration.js";
import { useAuth } from "../auth/AuthContext.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import Avatar from "../components/Avatar.js";
import CameraIcon from "../components/CameraIcon.js";
import EncryptionNotice from "../components/EncryptionNotice.js";
import { card } from "../lib/ui.js";

async function fetchInbox(): Promise<InboxSnap[]> {
  const res = await apiFetch<{ snaps: InboxSnap[] }>("/snaps/inbox");
  return res.snaps;
}

async function fetchFollowing(username: string): Promise<PublicUser[]> {
  const res = await apiFetch<{ users: PublicUser[] }>(`/users/${username}/following`);
  return res.users;
}

async function fetchStreaks(): Promise<SnapStreakSummary[]> {
  const res = await apiFetch<{ streaks: SnapStreakSummary[] }>("/snaps/streaks");
  return res.streaks;
}

type ShareTarget = "post" | "story" | "snap";

export default function SnapsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [friendSearch, setFriendSearch] = useState("");
  const [text, setText] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioStep, setStudioStep] = useState<"capture" | "review">("capture");
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<InboxSnap | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [viewingText, setViewingText] = useState("");
  const [snapError, setSnapError] = useState<string | null>(null);
  const [sendingError, setSendingError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("camera") !== "1") return;
    setStudioOpen(true);
    setStudioStep("capture");
    setSelectedImage(null);
    setPreviewUrl(null);
    setSelectedRecipients([]);
    setFriendSearch("");
    setText("");
    setShareTarget(null);
    setCameraError(null);
    setSendingError(null);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data: snaps = [] } = useQuery({
    queryKey: ["snaps-inbox"],
    queryFn: fetchInbox,
  });
  const { data: following = [] } = useQuery({
    queryKey: ["following", user?.username],
    queryFn: () => fetchFollowing(user!.username),
    enabled: !!user,
  });
  const { data: streaks = [] } = useQuery({
    queryKey: ["snap-streaks"],
    queryFn: fetchStreaks,
  });

  const normalizedSearch = friendSearch.trim().replace(/^@/, "").toLocaleLowerCase();
  const matchingFriends = following
    .filter((friend) => {
      if (!normalizedSearch) return true;
      return friend.username.toLocaleLowerCase().includes(normalizedSearch) ||
        friend.displayName?.toLocaleLowerCase().includes(normalizedSearch);
    })
    .sort((a, b) => {
      const aName = `${a.displayName ?? ""} ${a.username}`.toLocaleLowerCase();
      const bName = `${b.displayName ?? ""} ${b.username}`.toLocaleLowerCase();
      return Number(!aName.startsWith(normalizedSearch)) - Number(!bName.startsWith(normalizedSearch));
    });
  const streakByFriend = new Map(streaks.map((streak) => [streak.friend.id, streak]));

  useEffect(() => {
    return () => {
      if (viewingImageUrl) URL.revokeObjectURL(viewingImageUrl);
    };
  }, [viewingImageUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!studioOpen || studioStep !== "capture") return;
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera access is unavailable. Choose a photo instead.");
        return;
      }
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = cameraStream;
        if (videoRef.current) {
          videoRef.current.srcObject = cameraStream;
          await videoRef.current.play();
        }
      } catch {
        if (!cancelled) setCameraError("Camera access was denied. Choose a photo instead.");
      }
    }

    void startCamera();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [studioOpen, studioStep]);

  useEffect(() => {
    if (!viewing) return;
    const timeout = window.setTimeout(() => {
      setViewing(null);
      setViewingImageUrl(null);
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [viewing]);

  function toggleRecipient(username: string) {
    setSelectedRecipients((prev) =>
      prev.includes(username) ? prev.filter((u) => u !== username) : [...prev, username]
    );
  }

  function onSelectImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSelectedImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    setStudioOpen(true);
    setStudioStep("review");
    setShareTarget(null);
    setCameraError(null);
    setSendingError(null);
  }

  function openCamera() {
    setStudioOpen(true);
    setStudioStep("capture");
    setSelectedImage(null);
    setPreviewUrl(null);
    setSelectedRecipients([]);
    setFriendSearch("");
    setText("");
    setShareTarget(null);
    setCameraError(null);
    setSendingError(null);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError("The camera is still starting. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Could not capture this photo. Please try again.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError("Could not capture this photo. Please try again.");
        return;
      }
      const image = new File([blob], "camera-snap.jpg", { type: "image/jpeg" });
      setSelectedImage(image);
      setPreviewUrl(URL.createObjectURL(image));
      setShareTarget(null);
      setSendingError(null);
      setStudioStep("review");
    }, "image/jpeg", 0.92);
  }

  function retakePhoto() {
    setSelectedImage(null);
    setPreviewUrl(null);
    setShareTarget(null);
    setCameraError(null);
    setSendingError(null);
    setStudioStep("capture");
  }

  function closeStudio() {
    setStudioOpen(false);
    setStudioStep("capture");
    setSelectedImage(null);
    setPreviewUrl(null);
    setSelectedRecipients([]);
    setFriendSearch("");
    setText("");
    setShareTarget(null);
    setCameraError(null);
    setSendingError(null);
  }

  async function sharePhoto() {
    if (!selectedImage || !shareTarget) return;
    if (shareTarget === "snap" && selectedRecipients.length === 0) return;
    setSending(true);
    setSendingError(null);
    try {
      if (shareTarget === "snap") {
        if (!user) throw new Error("Sign in to send an encrypted Snap.");
        await registerDeviceEncryptionKey(user.id);
        const keyResponse = await apiFetch<{ keys: PublicEncryptionKey[] }>(
          "/snaps/encryption-keys",
          {
            method: "POST",
            body: JSON.stringify({ recipientUsernames: selectedRecipients }),
          }
        );
        const recipientIds = [
          user.id,
          ...following
            .filter((friend) => selectedRecipients.includes(friend.username))
            .map((friend) => friend.id),
        ];
        const keyedUsers = new Set(keyResponse.keys.map((key) => key.userId));
        if (recipientIds.some((userId) => !keyedUsers.has(userId))) {
          throw new Error("You and each recipient must open the app once to enable Snap encryption.");
        }
        const { encryptedImage, payload } = await encryptSnap(
          selectedImage,
          text,
          keyResponse.keys
        );
        const imageKey = await uploadMedia(encryptedImage);
        await apiFetch("/snaps", {
          method: "POST",
          body: JSON.stringify({
            imageKey,
            encryptedPayload: payload,
            recipientUsernames: selectedRecipients,
          }),
        });
      } else {
        const imageKey = await uploadMedia(selectedImage);
        if (shareTarget === "post") {
          await apiFetch("/posts", {
            method: "POST",
            body: JSON.stringify({
              imageKey,
              text: text.trim() || undefined,
              visibility: "public",
            }),
          });
        } else {
          await apiFetch("/stories", {
            method: "POST",
            body: JSON.stringify({ imageKey, visibility: "public" }),
          });
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feed", "first"] }),
        queryClient.invalidateQueries({ queryKey: ["stories"] }),
        queryClient.invalidateQueries({ queryKey: ["snaps-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["snap-streaks"] }),
      ]);
      closeStudio();
    } catch (error) {
      setSendingError(error instanceof Error ? error.message : "Could not send this Snap. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function openSnap(snap: InboxSnap) {
    setSnapError(null);
    try {
      let image = await downloadMediaBlob(snap.imageKey);
      let caption = snap.text ?? "";
      if (snap.isEncrypted) {
        if (!snap.encryptedPayload || !user) {
          throw new Error("Encrypted Snap data is missing or unavailable on this device.");
        }
        const localKeys = await getDeviceEncryptionKeys(user.id);
        const decrypted = await decryptSnap(image, snap.encryptedPayload, localKeys);
        image = decrypted.image;
        caption = decrypted.text;
      }
      await apiFetch(`/snaps/${snap.id}/view`, { method: "POST" });
      setViewingImageUrl(URL.createObjectURL(image));
      setViewingText(caption);
      setViewing(snap);
      await queryClient.invalidateQueries({ queryKey: ["snaps-inbox"] });
    } catch (error) {
      setSnapError(error instanceof Error ? error.message : "Could not load this Snap. Please try again.");
    }
  }

  function closeSnap() {
    if (viewingImageUrl) URL.revokeObjectURL(viewingImageUrl);
    setViewingImageUrl(null);
    setViewingText("");
    setViewing(null);
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4 pb-28 sm:py-8 sm:pb-8">
      <PageHeader title="Snaps" />
      <NavBar />
      <div className="mb-4 flex flex-col items-start gap-2">
        <p className="w-fit bg-[linear-gradient(90deg,#ef4444_0%,#f97316_20%,#eab308_40%,#22c55e_60%,#3b82f6_80%,#d946ef_100%)] bg-clip-text text-sm font-semibold text-transparent">
          Send a Snap, keep a streak going.
        </p>
        <div className="flex flex-col items-start gap-1">
          <EncryptionNotice encrypted />
          <p className="text-[11px] text-gray-500">Sender, recipient, and view times remain visible to the server.</p>
        </div>
      </div>

      <main className="flex min-w-0 flex-col gap-4">
        <section aria-label="Create a Snap" className={`${card} flex min-w-0 items-center justify-between gap-4`}>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Create</h2>
            <p className="mt-1 text-xs text-gray-500">Take a photo to post, add to your story, or send as a Snap.</p>
          </div>
          <button
            type="button"
            onClick={openCamera}
            className="hidden min-h-10 shrink-0 items-center gap-2 rounded-lg bg-fuchsia-600 px-3 text-sm font-semibold text-white hover:bg-fuchsia-700 sm:flex"
          >
            <CameraIcon />
            Open camera
          </button>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <section aria-label="Snap streaks" className={`${card} p-0`}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Your streaks</h2>
                <p className="mt-0.5 text-xs text-gray-500">Reply to each other within 24 hours</p>
              </div>
              <span aria-hidden="true" className="text-xl">🔥</span>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {streaks.map((streak) => (
                <button
                  key={streak.friend.id}
                  type="button"
                  onClick={() => toggleRecipient(streak.friend.username)}
                  className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-gray-50"
                >
                  <Avatar avatarKey={streak.friend.avatarKey} username={streak.friend.username} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{streak.friend.displayName || `@${streak.friend.username}`}</span>
                    <span className="block truncate text-xs text-gray-500">
                        {streak.waitingForYou ? "They sent a Snap. Send one back!" : streak.waitingForThem ? "Your turn is done. Waiting for them." : streak.currentStreak ? "Keep it going today" : streak.bestStreak ? `Best streak: ${streak.bestStreak}` : "Send Snaps both ways to start"}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-bold ${streak.currentStreak ? "text-orange-600" : "text-gray-400"}`}>
                    🔥 {streak.currentStreak || 0}
                  </span>
                </button>
              ))}
              {streaks.length === 0 && (
                <p className="px-4 py-5 text-sm text-gray-500">Your first mutual Snap starts a streak.</p>
              )}
            </div>
            {streaks.some((streak) => streak.bestStreak > 0) && (
              <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
                Best streaks are saved even after a current streak ends.
              </p>
            )}
          </section>

          <section aria-label="Received Snaps" className={`${card} p-0`}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-bold text-gray-900">Received</h2>
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-bold text-yellow-900">{snaps.length}</span>
            </div>
            {snapError && <p role="alert" className="px-4 pt-3 text-sm text-red-600">{snapError}</p>}
            <div className="max-h-80 overflow-y-auto">
              {snaps.map((snap) => (
                <button
                  key={snap.id}
                  onClick={() => void openSnap(snap)}
                  className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-yellow-50"
                >
                  <span className="rounded-full bg-[#FFFC00] p-0.5">
                    <Avatar avatarKey={snap.sender.avatarKey} username={snap.sender.username} size={42} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">{snap.sender.displayName || `@${snap.sender.username}`}</span>
                    <span className="block text-xs text-gray-500">New Snap · {new Date(snap.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    {snap.isEncrypted && (
                      <span className="mt-1 block"><EncryptionNotice encrypted /></span>
                    )}
                  </span>
                  <span className="h-3 w-3 shrink-0 rounded-full bg-yellow-400" aria-label="Unopened" />
                </button>
              ))}
              {snaps.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500">You’re all caught up. New Snaps show up here.</p>
              )}
            </div>
          </section>
        </aside>
      </main>

      {studioOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={studioStep === "capture" ? "Camera" : "Review photo"}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onSelectImage}
          />
          <header className="z-10 flex min-h-14 items-center justify-between border-b border-white/15 px-4">
            <button type="button" onClick={closeStudio} className="min-h-10 px-2 text-sm text-white/80 hover:text-white">Cancel</button>
            <h2 className="text-sm font-semibold">{studioStep === "capture" ? "Camera" : "Review photo"}</h2>
            <span className="w-14" aria-hidden="true" />
          </header>

          {studioStep === "capture" ? (
            <>
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
                <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                {cameraError && (
                  <p role="alert" className="absolute left-4 right-4 top-1/2 -translate-y-1/2 text-center text-sm text-white">{cameraError}</p>
                )}
              </div>
              <footer className="flex min-h-28 items-center justify-center gap-8 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs font-medium text-white/80 hover:text-white">Choose photo</button>
                <button
                  type="button"
                  onClick={capturePhoto}
                  aria-label="Take photo"
                  className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-[5px] border-white bg-fuchsia-600 shadow-lg transition active:scale-95"
                >
                  <CameraIcon />
                </button>
                <span className="w-[4.5rem] text-center text-xs text-white/60">Rear camera</span>
              </footer>
            </>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black px-4 py-3">
                {previewUrl && <img src={previewUrl} alt="Captured photo preview" className="max-h-full max-w-full rounded-lg object-contain" />}
              </div>
              <footer className="max-h-[55vh] overflow-y-auto border-t border-white/15 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-gray-900">
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Share to</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["post", "Post"],
                    ["story", "Story"],
                    ["snap", "Snap"],
                  ] as const).map(([target, label]) => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => setShareTarget(target)}
                      aria-pressed={shareTarget === target}
                      className={`min-h-10 rounded-lg border px-3 text-sm font-semibold transition ${shareTarget === target ? "border-fuchsia-600 bg-fuchsia-50 text-fuchsia-800" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {shareTarget && shareTarget !== "story" && (
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={shareTarget === "post" ? 2000 : 500}
                    rows={2}
                    placeholder="Add a caption..."
                    className="mt-3 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                  />
                )}

                {shareTarget === "snap" && (
                  <div className="mt-3">
                    <label htmlFor="snap-friend-search" className="mb-2 block text-xs font-semibold text-gray-600">Send to friends</label>
                    <input
                      id="snap-friend-search"
                      value={friendSearch}
                      onChange={(event) => setFriendSearch(event.target.value)}
                      placeholder="Search by name or @username"
                      className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                    />
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200">
                      {matchingFriends.map((friend) => {
                        const selected = selectedRecipients.includes(friend.username);
                        return (
                          <button
                            key={friend.id}
                            type="button"
                            onClick={() => toggleRecipient(friend.username)}
                            aria-pressed={selected}
                            className="flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50"
                          >
                            <Avatar avatarKey={friend.avatarKey} username={friend.username} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{friend.displayName || `@${friend.username}`}</span>
                              {friend.displayName && <span className="block text-xs text-gray-500">@{friend.username}</span>}
                            </span>
                            <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${selected ? "border-fuchsia-600 bg-fuchsia-600 text-white" : "border-gray-300 text-transparent"}`}>✓</span>
                          </button>
                        );
                      })}
                      {matchingFriends.length === 0 && (
                        <p className="px-3 py-3 text-sm text-gray-500">{following.length ? "No friends match that search." : "Follow someone to send them a Snap."}</p>
                      )}
                    </div>
                    {selectedRecipients.length > 0 && <p className="mt-1 text-xs text-gray-500">Selected: {selectedRecipients.map((name) => `@${name}`).join(", ")}</p>}
                  </div>
                )}

                {sendingError && <p role="alert" className="mt-3 text-sm text-red-600">{sendingError}</p>}
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={retakePhoto} disabled={sending} className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Retake</button>
                  <button
                    type="button"
                    onClick={() => void sharePhoto()}
                    disabled={sending || !shareTarget || (shareTarget === "snap" && selectedRecipients.length === 0)}
                    className="min-h-11 flex-1 rounded-lg bg-fuchsia-600 px-3 text-sm font-semibold text-white hover:bg-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {sending ? "Sharing..." : shareTarget === "post" ? "Post photo" : shareTarget === "story" ? "Add to story" : shareTarget === "snap" ? "Send Snap" : "Choose where to share"}
                  </button>
                </div>
              </footer>
            </>
          )}
        </div>
      )}

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black"
          role="dialog"
          aria-modal="true"
          aria-label={`Snap from @${viewing.sender.username}`}
          onClick={closeSnap}
        >
          <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between border-b border-white/20 p-4 text-white" onClick={(event) => event.stopPropagation()}>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Avatar avatarKey={viewing.sender.avatarKey} username={viewing.sender.username} size={28} />
              {viewing.sender.displayName || `@${viewing.sender.username}`}
            </span>
            <button type="button" onClick={closeSnap} aria-label="Close Snap" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xl leading-none hover:bg-white/25">
              ×
            </button>
          </div>
          <img
            src={viewingImageUrl ?? undefined}
            alt=""
            onClick={(event) => event.stopPropagation()}
            className="max-h-screen max-w-full object-contain"
          />
          {viewing.isEncrypted && (
            <div className="absolute left-4 top-16 rounded bg-black/70 px-2 py-1">
              <EncryptionNotice encrypted />
            </div>
          )}
          {viewingText && (
            <p className="absolute bottom-10 max-w-[90vw] rounded-full bg-black/60 px-4 py-2 text-center text-white">
              {viewingText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
