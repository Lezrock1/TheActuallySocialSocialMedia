import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./env.js";
import { verifyAuthToken } from "./auth/token.js";
import { prisma } from "./db.js";

interface ActiveCall {
  conversationId: string;
  hostUserId: string;
  participantIds: Set<string>;
}

const MAX_CALL_PARTICIPANTS = 6;

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    result[key] = decodeURIComponent(value);
  }
  return result;
}

export function createRealtimeServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.corsOrigin, credentials: true },
  });

  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const token = cookies.auth_token;
    if (!token) {
      next(new Error("Not authenticated"));
      return;
    }
    try {
      const payload = verifyAuthToken(token);
      socket.data.userId = payload.userId;
      next();
    } catch {
      next(new Error("Invalid or expired session"));
    }
  });

  const activeCalls = new Map<string, ActiveCall>();

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId}`);

    socket.on("call:start", (payload: {
      callId: string;
      conversationId: string;
      callType: "audio" | "video";
    }, acknowledge: (result: { ok: boolean; error?: string }) => void) => {
      void (async () => {
        const userId = socket.data.userId as string;
        const members = await prisma.conversationMember.findMany({
          where: { conversationId: payload.conversationId },
          select: { userId: true },
        });
        if (!members.some((member) => member.userId === userId)) {
          acknowledge({ ok: false, error: "Conversation not found" });
          return;
        }
        if (members.length < 2 || members.length > MAX_CALL_PARTICIPANTS) {
          acknowledge({ ok: false, error: `Calls support 2–${MAX_CALL_PARTICIPANTS} participants` });
          return;
        }
        if (activeCalls.has(payload.callId) ||
          [...activeCalls.values()].some((call) => call.participantIds.has(userId))) {
          acknowledge({ ok: false, error: "You are already in a call" });
          return;
        }

        activeCalls.set(payload.callId, {
          conversationId: payload.conversationId,
          hostUserId: userId,
          participantIds: new Set([userId]),
        });
        emitToUsers(
          io,
          members.map((member) => member.userId).filter((memberId) => memberId !== userId),
          "call:incoming",
          {
            callId: payload.callId,
            conversationId: payload.conversationId,
            callType: payload.callType,
            callerId: userId,
          }
        );
        acknowledge({ ok: true });
      })().catch(() => acknowledge({ ok: false, error: "Could not start the call" }));
    });

    socket.on("call:join", (payload: {
      callId: string;
      conversationId: string;
    }, acknowledge: (result: { ok: boolean; error?: string; peerIds?: string[] }) => void) => {
      void (async () => {
        const userId = socket.data.userId as string;
        const call = activeCalls.get(payload.callId);
        const membership = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: payload.conversationId,
              userId,
            },
          },
        });
        if (!call || call.conversationId !== payload.conversationId || !membership) {
          acknowledge({ ok: false, error: "This call is no longer available" });
          return;
        }
        if (!call.participantIds.has(userId) && call.participantIds.size >= MAX_CALL_PARTICIPANTS) {
          acknowledge({ ok: false, error: "This call is full" });
          return;
        }

        const peerIds = [...call.participantIds].filter((peerId) => peerId !== userId);
        call.participantIds.add(userId);
        emitToUsers(io, peerIds, "call:participant-joined", { callId: payload.callId, userId });
        acknowledge({ ok: true, peerIds });
      })().catch(() => acknowledge({ ok: false, error: "Could not join the call" }));
    });

    socket.on("call:signal", (payload: {
      callId: string;
      targetUserId: string;
      kind: "description" | "candidate";
      signal: unknown;
    }) => {
      const userId = socket.data.userId as string;
      const call = activeCalls.get(payload.callId);
      if (!call || !call.participantIds.has(userId) || !call.participantIds.has(payload.targetUserId)) return;
      emitToUsers(io, [payload.targetUserId], "call:signal", {
        callId: payload.callId,
        fromUserId: userId,
        kind: payload.kind,
        signal: payload.signal,
      });
    });

    socket.on("call:decline", (payload: { callId: string }) => {
      const userId = socket.data.userId as string;
      const call = activeCalls.get(payload.callId);
      if (!call || call.participantIds.has(userId)) return;
      void prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: call.conversationId, userId } },
        select: { userId: true },
      }).then((membership) => {
        if (membership) emitToUsers(io, [call.hostUserId], "call:declined", { callId: payload.callId, userId });
      }).catch(() => undefined);
    });

    socket.on("call:leave", (payload: { callId: string }) => {
      leaveCall(socket.data.userId as string, payload.callId);
    });

    socket.on("disconnect", () => {
      const userId = socket.data.userId as string;
      for (const callId of activeCalls.keys()) leaveCall(userId, callId);
    });

    function leaveCall(userId: string, callId: string) {
      const call = activeCalls.get(callId);
      if (!call || !call.participantIds.has(userId)) return;
      call.participantIds.delete(userId);
      const otherParticipants = [...call.participantIds];
      if (userId === call.hostUserId) {
        activeCalls.delete(callId);
        emitToUsers(io, otherParticipants, "call:ended", { callId });
        return;
      }
      emitToUsers(io, otherParticipants, "call:participant-left", { callId, userId });
      if (otherParticipants.length === 0) activeCalls.delete(callId);
    }
  });

  return io;
}

export function emitToUsers(
  io: SocketIOServer,
  userIds: string[],
  event: string,
  payload: unknown
): void {
  for (const userId of userIds) {
    io.to(`user:${userId}`).emit(event, payload);
  }
}
