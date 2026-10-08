import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveRoom, LiveRoomAudience } from "@app/shared";
import { getSocket } from "./socket.js";

export type CallType = "audio" | "video";

export interface IncomingCall {
  callId: string;
  conversationId: string;
  callType: CallType;
  callerId: string;
}

export interface ActiveCall {
  callId: string;
  conversationId: string;
  callType: CallType;
  hostUserId: string;
  participantIds: string[];
  isRoom: boolean;
  audience: LiveRoomAudience;
}

interface CallAcknowledgement {
  ok: boolean;
  error?: string;
  peerIds?: string[];
}

interface CallSignalMessage {
  callId: string;
  fromUserId: string;
  kind: "description" | "candidate";
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

function emitWithAck<T>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = getSocket();
    const timeout = window.setTimeout(() => reject(new Error("Call signaling timed out")), 10_000);
    socket.emit(event, payload, (result: T) => {
      window.clearTimeout(timeout);
      resolve(result);
    });
  });
}

export function useWebRtcCall(userId: string | undefined, ignoreIncomingCalls = false) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [remoteMuted, setRemoteMuted] = useState<Record<string, boolean>>({});
  const microphoneMutedRef = useRef(false);
  const [callError, setCallError] = useState<string | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());

  const updateActiveCall = useCallback((call: ActiveCall | null) => {
    activeCallRef.current = call;
    setActiveCall(call);
  }, []);

  const updateIncomingCall = useCallback((call: IncomingCall | null) => {
    incomingCallRef.current = call;
    setIncomingCall(call);
  }, []);

  const clearCall = useCallback(() => {
    for (const peer of peersRef.current.values()) peer.close();
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setMicrophoneMuted(false);
    microphoneMutedRef.current = false;
    setRemoteMuted({});
    setCameraEnabled(true);
    updateActiveCall(null);
  }, [updateActiveCall]);

  const sendSignal = useCallback((callId: string, targetUserId: string, kind: CallSignalMessage["kind"], signal: RTCSessionDescriptionInit | RTCIceCandidateInit) => {
    getSocket().emit("call:signal", { callId, targetUserId, kind, signal });
  }, []);

  const createPeer = useCallback((peerUserId: string, callId: string, initiator: boolean) => {
    const existing = peersRef.current.get(peerUserId);
    if (existing) return existing;
    const stream = localStreamRef.current;
    if (!stream) return null;

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peersRef.current.set(peerUserId, peer);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      if (event.candidate) sendSignal(callId, peerUserId, "candidate", event.candidate.toJSON());
    };
    peer.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (remoteStream) setRemoteStreams((current) => ({ ...current, [peerUserId]: remoteStream }));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") setCallError("Could not connect. Your network may require a TURN relay.");
    };

    if (initiator) {
      void peer.createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .then(() => {
          if (peer.localDescription) {
            sendSignal(callId, peerUserId, "description", peer.localDescription.toJSON());
          }
        })
        .catch(() => setCallError("Could not start the media connection."));
    }
    return peer;
  }, [sendSignal]);

  const receiveSignal = useCallback(async (message: CallSignalMessage) => {
    const call = activeCallRef.current;
    if (!call || call.callId !== message.callId || !userId) return;
    const initiator = userId.localeCompare(message.fromUserId) < 0;
    const peer = createPeer(message.fromUserId, message.callId, initiator);
    if (!peer) return;

    try {
      if (message.kind === "candidate") {
        const candidate = message.signal as RTCIceCandidateInit;
        if (peer.remoteDescription) {
          await peer.addIceCandidate(candidate);
        } else {
          const pending = pendingCandidatesRef.current.get(message.fromUserId) ?? [];
          pending.push(candidate);
          pendingCandidatesRef.current.set(message.fromUserId, pending);
        }
        return;
      }

      const description = message.signal as RTCSessionDescriptionInit;
      await peer.setRemoteDescription(description);
      const pending = pendingCandidatesRef.current.get(message.fromUserId) ?? [];
      pendingCandidatesRef.current.delete(message.fromUserId);
      for (const candidate of pending) await peer.addIceCandidate(candidate);

      if (description.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        if (peer.localDescription) {
          sendSignal(message.callId, message.fromUserId, "description", peer.localDescription.toJSON());
        }
      }
    } catch {
      setCallError("Could not establish the media connection.");
    }
  }, [createPeer, sendSignal, userId]);

  useEffect(() => {
    if (!userId) return;
    const currentUserId = userId;
    const socket = getSocket();
    function onIncoming(call: IncomingCall) {
      if (ignoreIncomingCalls) return;
      if (activeCallRef.current) {
        socket.emit("call:decline", { callId: call.callId });
        return;
      }
      updateIncomingCall(call);
    }
    function onParticipantJoined(payload: { callId: string; userId: string }) {
      const call = activeCallRef.current;
      if (!call || call.callId !== payload.callId || payload.userId === currentUserId) return;
      setActiveCall((current) => current && current.callId === payload.callId
        ? { ...current, participantIds: [...new Set([...current.participantIds, payload.userId])] }
        : current);
      createPeer(payload.userId, payload.callId, currentUserId.localeCompare(payload.userId) < 0);
      // Newcomers can't know who is already muted, so repeat our state for them.
      if (microphoneMutedRef.current) socket.emit("call:media-state", { callId: payload.callId, microphoneMuted: true });
    }
    function onMediaState(payload: { callId: string; userId: string; microphoneMuted: boolean }) {
      if (activeCallRef.current?.callId !== payload.callId) return;
      setRemoteMuted((current) => ({ ...current, [payload.userId]: payload.microphoneMuted === true }));
    }
    function onSignal(message: CallSignalMessage) {
      void receiveSignal(message);
    }
    function onParticipantLeft(payload: { callId: string; userId: string }) {
      const call = activeCallRef.current;
      if (!call || call.callId !== payload.callId) return;
      peersRef.current.get(payload.userId)?.close();
      peersRef.current.delete(payload.userId);
      pendingCandidatesRef.current.delete(payload.userId);
      setRemoteMuted((current) => {
        const next = { ...current };
        delete next[payload.userId];
        return next;
      });
      setRemoteStreams((current) => {
        const next = { ...current };
        delete next[payload.userId];
        return next;
      });
      setActiveCall((current) => current && current.callId === payload.callId
        ? { ...current, participantIds: current.participantIds.filter((id) => id !== payload.userId) }
        : current);
    }
    function onCallEnded(payload: { callId: string }) {
      if (activeCallRef.current?.callId === payload.callId) clearCall();
      if (incomingCallRef.current?.callId === payload.callId) updateIncomingCall(null);
    }
    function onCallDeclined() {
      setCallError("Someone declined the call.");
    }

    socket.on("call:incoming", onIncoming);
    socket.on("call:participant-joined", onParticipantJoined);
    socket.on("call:signal", onSignal);
    socket.on("call:participant-left", onParticipantLeft);
    socket.on("call:media-state", onMediaState);
    socket.on("call:ended", onCallEnded);
    socket.on("call:declined", onCallDeclined);
    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:participant-joined", onParticipantJoined);
      socket.off("call:signal", onSignal);
      socket.off("call:participant-left", onParticipantLeft);
      socket.off("call:media-state", onMediaState);
      socket.off("call:ended", onCallEnded);
      socket.off("call:declined", onCallDeclined);
      if (activeCallRef.current) {
        socket.emit("call:leave", { callId: activeCallRef.current.callId });
        clearCall();
      }
    };
  }, [clearCall, createPeer, ignoreIncomingCalls, receiveSignal, updateIncomingCall, userId]);

  async function startCall(
    conversationId: string,
    callType: CallType,
    isRoom = false,
    audience: LiveRoomAudience = "invited"
  ) {
    if (!userId || activeCallRef.current) return;
    setCallError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === "video" ? { facingMode: { ideal: "user" } } : false,
      });
      const callId = crypto.randomUUID();
      const call: ActiveCall = {
        callId,
        conversationId,
        callType,
        hostUserId: userId,
        participantIds: [userId],
        isRoom,
        audience,
      };
      localStreamRef.current = stream;
      setLocalStream(stream);
      updateActiveCall(call);
      const result = await emitWithAck<CallAcknowledgement>("call:start", { callId, conversationId, callType, isRoom, audience });
      if (!result.ok) throw new Error(result.error ?? "Could not start the call");
    } catch (error) {
      clearCall();
      setCallError(error instanceof Error ? error.message : "Could not access the microphone or camera.");
    }
  }

  async function joinLiveRoom(room: LiveRoom) {
    if (!userId || activeCallRef.current) return;
    setCallError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      updateIncomingCall(null);
      updateActiveCall({
        callId: room.callId,
        conversationId: room.conversationId,
        callType: "video",
        hostUserId: room.hostUserId,
        participantIds: [userId],
        isRoom: true,
        audience: room.audience,
      });
      const result = await emitWithAck<CallAcknowledgement>("call:join", {
        callId: room.callId,
        conversationId: room.conversationId,
      });
      if (!result.ok) throw new Error(result.error ?? "Could not join the room");
      const peerIds = result.peerIds ?? [];
      setActiveCall((current) => current?.callId === room.callId
        ? { ...current, participantIds: [...new Set([...current.participantIds, ...peerIds])] }
        : current);
      for (const peerUserId of peerIds) {
        createPeer(peerUserId, room.callId, userId.localeCompare(peerUserId) < 0);
      }
    } catch (error) {
      clearCall();
      setCallError(error instanceof Error ? error.message : "Could not access the camera or join this room.");
    }
  }

  async function acceptCall() {
    const incoming = incomingCallRef.current;
    if (!userId || !incoming || activeCallRef.current) return;
    setCallError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incoming.callType === "video" ? { facingMode: { ideal: "user" } } : false,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      updateActiveCall({
        ...incoming,
        hostUserId: incoming.callerId,
        participantIds: [userId],
        isRoom: false,
        audience: "invited",
      });
      updateIncomingCall(null);
      const result = await emitWithAck<CallAcknowledgement>("call:join", {
        callId: incoming.callId,
        conversationId: incoming.conversationId,
      });
      if (!result.ok) throw new Error(result.error ?? "Could not join the call");
      for (const peerUserId of result.peerIds ?? []) {
        createPeer(peerUserId, incoming.callId, userId.localeCompare(peerUserId) < 0);
      }
    } catch (error) {
      clearCall();
      setCallError(error instanceof Error ? error.message : "Could not access the microphone or camera.");
    }
  }

  function declineCall() {
    const incoming = incomingCallRef.current;
    if (incoming) getSocket().emit("call:decline", { callId: incoming.callId });
    updateIncomingCall(null);
  }

  function endCall() {
    const call = activeCallRef.current;
    if (call) getSocket().emit("call:leave", { callId: call.callId });
    clearCall();
  }

  function toggleMicrophone() {
    const nextMuted = !microphoneMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setMicrophoneMuted(nextMuted);
    microphoneMutedRef.current = nextMuted;
    const call = activeCallRef.current;
    if (call) getSocket().emit("call:media-state", { callId: call.callId, microphoneMuted: nextMuted });
  }

  function toggleCamera() {
    const nextEnabled = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = nextEnabled; });
    setCameraEnabled(nextEnabled);
  }

  return {
    activeCall,
    incomingCall,
    localStream,
    remoteStreams,
    microphoneMuted,
    remoteMuted,
    cameraEnabled,
    callError,
    startCall,
    joinLiveRoom,
    acceptCall,
    declineCall,
    endCall,
    toggleMicrophone,
    toggleCamera,
    clearCallError: () => setCallError(null),
  };
}