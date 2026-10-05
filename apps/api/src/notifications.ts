import type { NotificationType } from "@app/shared";
import { prisma } from "./db.js";
import { getBlockedUserIds } from "./visibility.js";
import { sendWebPushNotification } from "./pushNotifications.js";

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