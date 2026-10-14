import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConversationSummary } from "@app/shared";
import { useAuth } from "../auth/AuthContext.js";
import { useWebRtcCall } from "../lib/useWebRtcCall.js";
import { apiFetch } from "../lib/api.js";
import CallOverlay from "./CallOverlay.js";

const CallContext = createContext<ReturnType<typeof useWebRtcCall> | null>(null);
export function useCalls() {
  const call = useContext(CallContext);
  if (!call) throw new Error("Call provider missing");
  return call;
}
export default function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const call = useWebRtcCall(user?.id);
  const conversationId = call.incomingCall?.conversationId ?? call.activeCall?.conversationId;
  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => (await apiFetch<{ conversations: ConversationSummary[] }>("/conversations")).conversations,
    enabled: !!user && !!conversationId,
  });
  return (
    <CallContext.Provider value={call}>
      {children}
      <CallOverlay
        incomingCall={call.incomingCall} activeCall={call.activeCall} currentUserId={user?.id ?? ""}
        users={conversations.find((conversation) => conversation.id === conversationId)?.members ?? []}
        localStream={call.localStream} remoteStreams={call.remoteStreams} microphoneMuted={call.microphoneMuted}
        remoteMuted={call.remoteMuted} remoteCameraOff={call.remoteCameraOff} cameraEnabled={call.cameraEnabled}
        error={call.callError} onAccept={() => void call.acceptCall()} onDecline={call.declineCall}
        onEnd={call.endCall} onToggleMicrophone={call.toggleMicrophone} onToggleCamera={call.toggleCamera}
        onClearError={call.clearCallError}
      />
    </CallContext.Provider>
  );
}