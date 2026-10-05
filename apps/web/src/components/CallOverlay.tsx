import { useEffect, useRef } from "react";
import type { PublicUser } from "@app/shared";
import type { ActiveCall, CallType, IncomingCall } from "../lib/useWebRtcCall.js";
import Avatar from "./Avatar.js";

function MediaTile({
  user,
  stream,
  showVideo,
  muted,
}: {
  user: PublicUser | null;
  stream: MediaStream | null;
  showVideo: boolean;
  muted: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      if (stream) void audioRef.current.play().catch(() => undefined);
    }
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
      if (audioRef.current) audioRef.current.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="relative flex aspect-video min-h-36 items-center justify-center overflow-hidden rounded-lg bg-gray-900">
      <audio ref={audioRef} autoPlay muted={muted} className="hidden" />
      {showVideo && stream?.getVideoTracks().some((track) => track.enabled) ? (
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      ) : (
        <Avatar avatarKey={user?.avatarKey ?? null} username={user?.username ?? "Call"} size={64} />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-5 text-xs font-medium text-white">
        {user?.displayName || (user ? `@${user.username}` : "You")}
      </span>
    </div>
  );
}

export default function CallOverlay({
  incomingCall,
  activeCall,
  currentUserId,
  users,
  localStream,
  remoteStreams,
  microphoneMuted,
  cameraEnabled,
  error,
  onAccept,
  onDecline,
  onEnd,
  onToggleMicrophone,
  onToggleCamera,
  onClearError,
}: {
  incomingCall: IncomingCall | null;
  activeCall: ActiveCall | null;
  currentUserId: string;
  users: PublicUser[];
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  microphoneMuted: boolean;
  cameraEnabled: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onClearError: () => void;
}) {
  if (!incomingCall && !activeCall && !error) return null;
  const callType: CallType = activeCall?.callType ?? incomingCall?.callType ?? "audio";
  const caller = incomingCall ? users.find((person) => person.id === incomingCall.callerId) : null;
  const callUsers = activeCall?.participantIds ?? [];
  const remoteUserIds = callUsers.filter((id) => id !== currentUserId);
  const remoteTileIds = [...new Set([...remoteUserIds, ...Object.keys(remoteStreams)])];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-6">
      {incomingCall && !activeCall ? (
        <section role="dialog" aria-modal="true" aria-label="Incoming call" className="w-full max-w-sm rounded-xl bg-white p-5 text-center shadow-2xl">
          <p className="text-xs font-semibold uppercase text-gray-500">Incoming {callType} call</p>
          <div className="my-5 flex flex-col items-center gap-3">
            <Avatar avatarKey={caller?.avatarKey ?? null} username={caller?.username ?? "?"} size={72} />
            <h2 className="text-lg font-semibold text-gray-900">
              {caller?.displayName || `@${caller?.username ?? "Someone"}`}
            </h2>
          </div>
          {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onDecline} className="min-h-11 flex-1 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">Decline</button>
            <button type="button" onClick={onAccept} className="min-h-11 flex-1 rounded-lg bg-green-600 px-3 text-sm font-semibold text-white hover:bg-green-700">Answer</button>
          </div>
        </section>
      ) : activeCall ? (
        <section role="dialog" aria-modal="true" aria-label={`${callType} call`} className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {activeCall?.isRoom ? "Live room" : callType === "video" ? "Video call" : "Audio call"}
              </h2>
              <p className="text-xs text-gray-500">{remoteUserIds.length ? `${remoteUserIds.length + 1} participants` : "Calling..."}</p>
            </div>
            <button type="button" onClick={onEnd} aria-label="End call" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-gray-500 hover:bg-gray-100">×</button>
          </header>
          <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-2 overflow-y-auto bg-gray-950 p-3 sm:grid-cols-2">
            <MediaTile
              user={users.find((person) => person.id === currentUserId) ?? null}
              stream={localStream}
              showVideo={callType === "video" && cameraEnabled}
              muted
            />
            {remoteTileIds.map((id) => (
              <MediaTile
                key={id}
                user={users.find((person) => person.id === id) ?? null}
                stream={remoteStreams[id] ?? null}
                showVideo={callType === "video"}
                muted={false}
              />
            ))}
          </div>
          <footer className="flex items-center justify-center gap-3 border-t border-gray-100 px-4 py-3">
            <button type="button" onClick={onToggleMicrophone} aria-pressed={!microphoneMuted} className="min-h-10 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              {microphoneMuted ? "Unmute" : "Mute"}
            </button>
            {callType === "video" && (
              <button type="button" onClick={onToggleCamera} aria-pressed={cameraEnabled} className="min-h-10 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                {cameraEnabled ? "Camera off" : "Camera on"}
              </button>
            )}
            <button type="button" onClick={onEnd} className="min-h-10 rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700">End call</button>
          </footer>
          {error && (
            <button type="button" onClick={onClearError} className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
              {error} · Dismiss
            </button>
          )}
        </section>
      ) : (
        <section role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
          <h2 className="text-sm font-semibold text-gray-900">Call unavailable</h2>
          <p className="mt-2 text-sm text-gray-600">{error}</p>
          <button type="button" onClick={onClearError} className="mt-4 min-h-10 w-full rounded-lg bg-black px-3 text-sm font-semibold text-white">Close</button>
        </section>
      )}
    </div>
  );
}