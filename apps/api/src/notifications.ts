import type { NotificationPreferences, NotificationType } from "@app/shared";
import { prisma } from "./db.js";
import { getBlockedUserIds } from "./visibility.js";
import { sendWebPushNotification } from "./pushNotifications.js";
import { isNotificationEnabled, notificationPreferenceSelect } from "./notificationPreferences.js";
import { selectPostNotificationRecipients } from "./postNotifications.js";
import { isQuietNow } from "./quietHours.js";
import type { Prisma } from "@prisma/client";
import type { Server } from "socket.io";
import { emitToUsers } from "./realtime.js";
import { dismissWebPushNotifications } from "./pushNotifications.js";

export async function completeUserNotifications(io: Server, recipientId: string, where: Prisma.NotificationWhereInput, dismiss = true): Promise<number> {
  const ids = await prisma.$transaction(async (transaction) => {
    const notifications = await transaction.notification.findMany({
      where: { ...where, recipientId, dismissedAt: null },
      select: { id: true },
    });
    if (!notifications.length) return [];
    const ids = notifications.map((notification) => notification.id);
    const now = new Date();
    await transaction.notification.updateMany({ where: { id: { in: ids }, recipientId }, data: { readAt: now, ...(dismiss ? { dismissedAt: now } : {}) } });
    return ids;
  });
  if (ids.length) {
    emitToUsers(io, [recipientId], "notifications:cleared", { ids });
    void dismissWebPushNotifications(recipientId, ids).catch(() => console.error("Could not synchronize notification dismissal"));
  }
  return ids.length;
}

export async function createUserNotification(input: {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  dedupeKey: string;
  postId?: string;
  commentId?: string;
  conversationId?: string;
  snapId?: string;
  storyId?: string;
  reactionEmoji?: string;
}): Promise<void> {
  if (input.recipientId === input.actorId) return;
  const preferences = await getNotificationPreferences(input.recipientId);
  if (!isNotificationEnabled(input.type, preferences)) return;
  try {
    const notification = input.type === "story_reaction"
      ? await prisma.notification.upsert({ where: { dedupeKey: input.dedupeKey }, create: input, update: { reactionEmoji: input.reactionEmoji, storyId: input.storyId, readAt: null, dismissedAt: null, createdAt: new Date() } })
      : await prisma.notification.create({ data: input });
    const inQuietHours = preferences !== null && isQuietNow({
      enabled: preferences.quietHoursEnabled,
      startMinute: preferences.quietStartMinute,
      endMinute: preferences.quietEndMinute,
      timezone: preferences.timezone,
    }, new Date());
    // Held back now; the quiet-hours digest job announces it afterwards.
    if (inQuietHours) return;
    void sendWebPushNotification({
      notificationId: notification.id,
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: input.type,
      postId: input.postId,
      conversationId: input.conversationId,
      snapId: input.snapId,
      storyId: input.storyId,
      reactionEmoji: input.reactionEmoji,
    }).catch(() => {
      console.error("Could not send web push notification");
    });
  } catch (error) {
    if (
      typeof error === "object" && error !== null &&
      "code" in error && error.code === "P2002"
    ) return;
    throw error;
  }
}

export async function createPostNotifications(input: {
  authorId: string;
  postId: string;
  visibility: "public" | "close_friends" | "circle";
  circleId?: string | null;
}): Promise<void> {
  const blockedIds = [...new Set([
    input.authorId,
    ...(await getBlockedUserIds(input.authorId)),
  ])];
  if (input.visibility === "circle") {
    if (!input.circleId) return;
    const members = await prisma.circleMember.findMany({
      where: { circleId: input.circleId, userId: { notIn: blockedIds } },
      select: { userId: true },
    });
    await Promise.all(members.map(({ userId }) => createUserNotification({
      recipientId: userId,
      actorId: input.authorId,
      type: "circle_post",
      dedupeKey: `post:${input.postId}:${userId}`,
      postId: input.postId,
    })));
    return;
  }
  const [followers, closeFriends] = await Promise.all([
    input.visibility === "public"
      ? prisma.follow.findMany({
          where: { followeeId: input.authorId, followerId: { notIn: blockedIds } },
          select: { followerId: true },
        })
      : Promise.resolve([]),
    prisma.closeFriend.findMany({
      where: { ownerId: input.authorId, friendId: { notIn: blockedIds } },
      select: { friendId: true },
    }),
  ]);
  const savedPreferences = closeFriends.length
    ? await prisma.notificationPreference.findMany({
        where: { userId: { in: closeFriends.map((friend) => friend.friendId) } },
        select: { userId: true, ...notificationPreferenceSelect },
      })
    : [];
  const preferencesByUserId = new Map(savedPreferences.map((preference) => [preference.userId, preference]));
    const recipients = selectPostNotificationRecipients({
      authorId: input.authorId,
      visibility: input.visibility,
      followerIds: followers.map((follower) => follower.followerId),
      closeFriendIds: closeFriends.map((friend) => friend.friendId),
      blockedIds,
      preferencesByUserId,
    });

    await Promise.all(recipients.map(({ recipientId, type }) =>
    createUserNotification({
      recipientId,
      actorId: input.authorId,
      type,
      dedupeKey: `post:${input.postId}:${recipientId}`,
      postId: input.postId,
    })
  ));
}

async function getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
  return prisma.notificationPreference.findUnique({
    where: { userId },
    select: notificationPreferenceSelect,
  });
}

export async function createMentionNotifications(input: {
  text: string;
  actorId: string;
  postId?: string;
  commentId?: string;
  excludedRecipientIds?: string[];
}): Promise<void> {
  const usernames = [
    ...new Set(
      [...input.text.matchAll(/(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})\b/g)].map(
        (match) => match[1]
      )
    ),
  ];
  if (usernames.length === 0) return;

  const [mentionedUsers, blockedIds] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: usernames.map((username) => ({
          username: { equals: username, mode: "insensitive" as const },
        })),
      },
      select: { id: true },
    }),
    getBlockedUserIds(input.actorId),
  ]);
  const excluded = new Set([
    input.actorId,
    ...blockedIds,
    ...(input.excludedRecipientIds ?? []),
  ]);
  const targetId = input.commentId ?? input.postId;
  if (!targetId) return;

  await Promise.all(
    mentionedUsers
      .filter((user) => !excluded.has(user.id))
      .map((user) =>
        createUserNotification({
          recipientId: user.id,
          actorId: input.actorId,
          type: "mention",
          dedupeKey: `mention:${targetId}:${user.id}`,
          ...(input.postId ? { postId: input.postId } : {}),
          ...(input.commentId ? { commentId: input.commentId } : {}),
        })
      )
  );
}