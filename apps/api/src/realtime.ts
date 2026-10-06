import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./env.js";
import { verifyAuthToken } from "./auth/token.js";
import { prisma } from "./db.js";
import { toPublicUser } from "./serializers.js";
import { getBlockedUserIds, isBlocked } from "./visibility.js";
import { LIVE_ROOM_AUDIENCES, MAX_LIVE_ROOM_PARTICIPANTS } from "@app/shared";
import type { LiveRoomAudience } from "@app/shared";
import { createUserNotification } from "./notifications.js";

interface ActiveCall {
  conversationId: string;
  hostUserId: string;
  participantIds: Set<string>;
  memberIds: string[];
  isRoom: boolean;
  audience: LiveRoomAudience;
}

const MAX_CALL_PARTICIPANTS = MAX_LIVE_ROOM_PARTICIPANTS;

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

async function canViewLiveRoom(userId: string, call: ActiveCall): Promise<boolean> {
  if (call.memberIds.includes(userId)) return true;
  if (!call.isRoom || await isBlocked(call.hostUserId, userId)) return false;
  if (call.audience === "everyone") return true;
  if (call.audience === "close_friends") {
    return !!(await prisma.closeFriend.findUnique({
      where: { ownerId_friendId: { ownerId: call.hostUserId, friendId: userId } },
      select: { id: true },
    }));
  }
  if (call.audience === "friends") {
    return !!(await prisma.follow.findFirst({
      where: {
        OR: [
          { followerId: call.hostUserId, followeeId: userId },
          { followerId: userId, followeeId: call.hostUserId },
        ],
      },
      select: { id: true },
    }));
  }
  return false;
}

async function getLiveRoomAudienceUserIds(call: ActiveCall): Promise<string[]> {
  const userIds = new Set(call.memberIds);
  if (call.audience === "close_friends") {
    const friends = await prisma.closeFriend.findMany({
      where: { ownerId: call.hostUserId },
      select: { friendId: true },
    });
    for (const friend of friends) userIds.add(friend.friendId);
  } else if (call.audience === "friends") {
    const follows = await prisma.follow.findMany({
      where: {
        OR: [{ followerId: call.hostUserId }, { followeeId: call.hostUserId }],
      },
      select: { followerId: true, followeeId: true },
    });
    for (const follow of follows) {
      userIds.add(follow.followerId === call.hostUserId ? follow.followeeId : follow.followerId);
    }
  }
  return [...userIds];
}

async function notifyLiveRoomAudienceChanged(io: SocketIOServer, call: ActiveCall): Promise<void> {
  if (call.audience === "everyone") {
    io.emit("live-rooms:changed", {});
    return;
  }
  emitToUsers(io, await getLiveRoomAudienceUserIds(call), "live-rooms:changed", {});
}

async function notifyLiveRoomStarted(callId: string, call: ActiveCall): Promise<void> {
  const audienceIds = call.audience === "everyone"
    ? call.memberIds
    : await getLiveRoomAudienceUserIds(call);
  const blockedIds = new Set(await getBlockedUserIds(call.hostUserId));
  const recipients = [...new Set(audienceIds)]
    .filter((recipientId) => recipientId !== call.hostUserId && !blockedIds.has(recipientId));
  await Promise.all(recipients.map((recipientId) => createUserNotification({
    recipientId,
    actorId: call.hostUserId,
    type: "live_room",
    dedupeKey: `live-room:${callId}:${recipientId}`,
  })));
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
      isRoom?: boolean;
      audience?: LiveRoomAudience;
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
        if (payload.isRoom && payload.callType !== "video") {
          acknowledge({ ok: false, error: "Live rooms require video" });
          return;
        }
        if (payload.isRoom && !LIVE_ROOM_AUDIENCES.includes(payload.audience ?? "invited")) {
          acknowledge({ ok: false, error: "Choose a valid room audience" });
          return;
        }
        const minimumParticipants = payload.isRoom && payload.audience !== "invited" ? 1 : 2;
        if (members.length < minimumParticipants || members.length > MAX_CALL_PARTICIPANTS) {
          acknowledge({ ok: false, error: `Calls support ${minimumParticipants}–${MAX_CALL_PARTICIPANTS} participants` });
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
          memberIds: members.map((member) => member.userId),
          isRoom: payload.isRoom === true,
          audience: payload.isRoom ? payload.audience ?? "invited" : "invited",
        });
        if (payload.isRoom) {
          const call = activeCalls.get(payload.callId)!;
          void notifyLiveRoomAudienceChanged(io, call).catch(() => undefined);
          void notifyLiveRoomStarted(payload.callId, call).catch(() => undefined);
        } else {
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
        }
        acknowledge({ ok: true });
      })().catch(() => acknowledge({ ok: false, error: "Could not start the call" }));
    });

    socket.on("live-rooms:list", (acknowledge: (rooms: import("@app/shared").LiveRoom[]) => void) => {
      void (async () => {
        const userId = socket.data.userId as string;
        const candidates = [...activeCalls.entries()].filter(([, call]) => call.isRoom);
        const activeRooms = (await Promise.all(candidates.map(async (entry) =>
          await canViewLiveRoom(userId, entry[1]) ? entry : null
        ))).filter((entry): entry is [string, ActiveCall] => entry !== null);
        if (activeRooms.length === 0) {
          acknowledge([]);
          return;
        }
        const conversations = await prisma.conversation.findMany({
          where: { id: { in: activeRooms.map(([, call]) => call.conversationId) } },
        });
        const participants = await prisma.user.findMany({
          where: { id: { in: activeRooms.flatMap(([, call]) => [...call.participantIds]) } },
        });
        const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
        const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
        acknowledge(activeRooms.flatMap(([callId, call]) => {
          const conversation = conversationsById.get(call.conversationId);
          if (!conversation) return [];
          return [{
            callId,
            conversationId: call.conversationId,
            title: conversation.name ?? "Live room",
            hostUserId: call.hostUserId,
            audience: call.audience,
            participantIds: [...call.participantIds],
            members: [...call.participantIds].flatMap((participantId) => {
              const participant = participantsById.get(participantId);
              return participant ? [toPublicUser(participant)] : [];
            }),
          }];
        }));
      })().catch(() => acknowledge([]));
    });

    socket.on("call:join", (payload: {
      callId: string;
      conversationId: string;
    }, acknowledge: (result: { ok: boolean; error?: string; peerIds?: string[] }) => void) => {
      void (async () => {
        const userId = socket.data.userId as string;
        const call = activeCalls.get(payload.callId);
        if (!call || call.conversationId !== payload.conversationId) {
          acknowledge({ ok: false, error: "This call is no longer available" });
          return;
        }
        const membership = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: payload.conversationId,
              userId,
            },
          },
        });
        if (!membership && !(await canViewLiveRoom(userId, call))) {
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
        if (call.isRoom) void notifyLiveRoomAudienceChanged(io, call).catch(() => undefined);
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
        if (call.isRoom) void notifyLiveRoomAudienceChanged(io, call).catch(() => undefined);
        if (call.isRoom && call.memberIds.length === 1) {
          void prisma.conversation.delete({ where: { id: call.conversationId } }).catch(() => undefined);
        }
        return;
      }
      emitToUsers(io, otherParticipants, "call:participant-left", { callId, userId });
      if (call.isRoom) void notifyLiveRoomAudienceChanged(io, call).catch(() => undefined);
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
