import type { NotificationPreferences, NotificationType } from "@app/shared";
import { prisma } from "./db.js";
import { getBlockedUserIds } from "./visibility.js";
import { sendWebPushNotification } from "./pushNotifications.js";
import { isNotificationEnabled } from "./notificationPreferences.js";
import { selectPostNotificationRecipients } from "./postNotifications.js";

export async function createUserNotification(input: {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  dedupeKey: string;
  postId?: string;
  commentId?: string;
  conversationId?: string;
  snapId?: string;
}): Promise<void> {
  if (input.recipientId === input.actorId) return;
  const preferences = await getNotificationPreferences(input.recipientId);
  if (!isNotificationEnabled(input.type, preferences)) return;
  try {
    const notification = await prisma.notification.create({ data: input });
    void sendWebPushNotification({
      notificationId: notification.id,
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: input.type,
      postId: input.postId,
      conversationId: input.conversationId,
      snapId: input.snapId,
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
  visibility: "public" | "close_friends";
}): Promise<void> {
  const blockedIds = [...new Set([
    input.authorId,
    ...(await getBlockedUserIds(input.authorId)),
  ])];
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
        select: {
          userId: true,
          postsFromFollowing: true,
          postsFromCloseFriends: true,
          snaps: true,
          messages: true,
          follows: true,
          comments: true,
          commentReplies: true,
          commentLikes: true,
          storyReactions: true,
          mentions: true,
          closeFriends: true,
        },
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
    select: {
      postsFromFollowing: true,
      postsFromCloseFriends: true,
      snaps: true,
      messages: true,
      follows: true,
      comments: true,
      commentReplies: true,
      commentLikes: true,
      storyReactions: true,
      mentions: true,
      closeFriends: true,
    },
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