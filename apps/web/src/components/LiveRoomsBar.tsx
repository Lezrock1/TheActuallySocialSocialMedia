import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LiveRoom, PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { useWebRtcCall } from "../lib/useWebRtcCall.js";
import { getSocket } from "../lib/socket.js";
import { btnPrimary, btnSecondary, input } from "../lib/ui.js";
import Avatar from "./Avatar.js";
import CallOverlay from "./CallOverlay.js";

async function fetchFriends(username: string): Promise<PublicUser[]> {
  const result = await apiFetch<{ users: PublicUser[] }>(`/users/${username}/following`);
  return result.users;
}

async function fetchLiveRooms(): Promise<LiveRoom[]> {
  return new Promise((resolve, reject) => {
    const socket = getSocket();
    const timeout = window.setTimeout(() => reject(new Error("Room list timed out")), 8_000);
    socket.emit("live-rooms:list", (rooms: LiveRoom[]) => {
      window.clearTimeout(timeout);
      resolve(rooms);
    });
  });
}

export default function LiveRoomsBar() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const call = useWebRtcCall(user?.id, true);
  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [localRoomMembers, setLocalRoomMembers] = useState<PublicUser[]>([]);

  const { data: friends = [] } = useQuery({
    queryKey: ["following", user?.username],
    queryFn: () => fetchFriends(user!.username),
    enabled: !!user,
    staleTime: 30_000,
  });
  const { data: rooms = [], isError: roomsError } = useQuery({
    queryKey: ["live-rooms"],
    queryFn: fetchLiveRooms,
    enabled: !!user,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const socket = getSocket();
    const refreshRooms = () => void queryClient.invalidateQueries({ queryKey: ["live-rooms"] });
    socket.on("live-rooms:changed", refreshRooms);
    return () => {
      socket.off("live-rooms:changed", refreshRooms);
    };
  }, [queryClient]);

  const activeRoom = rooms.find((room) => room.callId === call.activeCall?.callId);
  const callUsers = activeRoom?.members ?? localRoomMembers;

  function toggleFriend(username: string) {
    setRoomError(null);
    setSelectedUsernames((selected) => selected.includes(username)
      ? selected.filter((selectedUsername) => selectedUsername !== username)
      : selected.length < 5 ? [...selected, username] : selected);
  }

  async function startRoom() {
    if (!user || selectedUsernames.length === 0 || starting) return;
    setStarting(true);
    setRoomError(null);
    try {
      const result = await apiFetch<{ conversationId: string }>("/conversations/group", {
        method: "POST",
        body: JSON.stringify({
          name: roomName.trim() || "Live room",
          usernames: selectedUsernames,
        }),
      });
      const members = [user, ...friends.filter((friend) => selectedUsernames.includes(friend.username))];
      setLocalRoomMembers(members);
      setCreateOpen(false);
      await call.startCall(result.conversationId, "video", true);
      void queryClient.invalidateQueries({ queryKey: ["live-rooms"] });
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Could not start this room.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <section aria-label="Live rooms" className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-900">Live rooms</h2>
            <p className="mt-0.5 text-xs leading-4 text-gray-500">Drop in with up to 5 friends</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setRoomError(null);
              setCreateOpen((open) => !open);
            }}
            disabled={!!call.activeCall || !!call.incomingCall}
            className={`${btnPrimary} min-h-9 shrink-0 px-3 text-xs`}
          >
            {createOpen ? "Cancel" : "Start room"}
          </button>
        </div>

        {call.callError && <p role="alert" className="mt-2 text-xs text-red-600">{call.callError}</p>}
        {roomsError && <p className="mt-2 text-xs text-gray-500">Could not load live rooms.</p>}

        <div className="-mx-1 flex min-w-0 gap-4 overflow-x-auto px-1 pb-2">
          {rooms.map((room) => {
            const host = room.members.find((member) => member.id === room.hostUserId);
            const alreadyInRoom = room.participantIds.includes(user?.id ?? "");
            return (
              <button
                key={room.callId}
                type="button"
                onClick={() => {
                  setLocalRoomMembers(room.members);
                  void call.joinLiveRoom(room);
                }}
                disabled={alreadyInRoom || !!call.activeCall || !!call.incomingCall}
                aria-label={`${alreadyInRoom ? "Already in" : "Join"} live room hosted by @${host?.username ?? "friend"}`}
                title={room.title}
                className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 text-center disabled:cursor-default"
              >
                <span className="relative block rounded-full bg-gradient-to-br from-fuchsia-500 via-pink-500 to-orange-400 p-0.5">
                  <span className="block rounded-full border-2 border-white">
                    <Avatar avatarKey={host?.avatarKey ?? null} username={host?.username ?? "room"} size={54} />
                  </span>
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center">
                    <span aria-hidden="true" className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span aria-label="Live now" className="relative h-3 w-3 rounded-full border-2 border-white bg-red-600" />
                  </span>
                </span>
                <span className="block w-full truncate text-[11px] font-semibold leading-4 text-gray-800">Live room</span>
                <span className="block w-full truncate text-[10px] leading-3 text-gray-500">@{host?.username ?? "friend"}</span>
              </button>
            );
          })}
          {!roomsError && rooms.length === 0 && (
            <p className="py-2 text-xs text-gray-500">No friends are live right now.</p>
          )}
        </div>

        {createOpen && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
            <label className="mb-2 block text-xs font-medium text-gray-700">
              Room name
              <input
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                maxLength={60}
                placeholder="Live room"
                className={`${input} mt-1 w-full`}
              />
            </label>
            <p className="mb-2 text-[11px] text-gray-500">Choose friends to invite. They can join while the room is live.</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100">
              {friends.map((friend) => {
                const selected = selectedUsernames.includes(friend.username);
                return (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => toggleFriend(friend.username)}
                    aria-pressed={selected}
                    className="flex w-full items-center gap-2 border-b border-gray-100 px-2.5 py-2 text-left last:border-b-0 hover:bg-gray-50"
                  >
                    <Avatar avatarKey={friend.avatarKey} username={friend.username} size={32} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800">
                      {friend.displayName || `@${friend.username}`}
                    </span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${selected ? "border-fuchsia-600 bg-fuchsia-600 text-white" : "border-gray-300 text-transparent"}`}>✓</span>
                  </button>
                );
              })}
              {friends.length === 0 && <p className="px-3 py-3 text-xs text-gray-500">Follow friends to invite them to a room.</p>}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-500">{selectedUsernames.length}/5 friends</span>
              <button
                type="button"
                onClick={() => void startRoom()}
                disabled={starting || !selectedUsernames.length}
                className={`${btnSecondary} min-h-9 text-xs`}
              >
                {starting ? "Starting…" : "Go live"}
              </button>
            </div>
            {roomError && <p role="alert" className="mt-2 text-xs text-red-600">{roomError}</p>}
          </div>
        )}
        <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] leading-4 text-gray-400">
          Rooms stay live while the host remains on this page. Always-on livestreams need dedicated streaming infrastructure.
        </p>
      </section>

      <CallOverlay
        incomingCall={null}
        activeCall={call.activeCall}
        currentUserId={user?.id ?? ""}
        users={callUsers}
        localStream={call.localStream}
        remoteStreams={call.remoteStreams}
        microphoneMuted={call.microphoneMuted}
        cameraEnabled={call.cameraEnabled}
        error={call.callError}
        onAccept={call.acceptCall}
        onDecline={call.declineCall}
        onEnd={call.endCall}
        onToggleMicrophone={call.toggleMicrophone}
        onToggleCamera={call.toggleCamera}
        onClearError={call.clearCallError}
      />
    </>
  );
}