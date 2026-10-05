import type { NotificationPreferences, NotificationType } from "@app/shared";
import { isNotificationEnabled } from "./notificationPreferences.js";

type PostNotificationType = Extract<NotificationType, "post" | "close_friend_post">;

export function selectPostNotificationRecipients(input: {
  authorId: string;
  visibility: "public" | "close_friends";
  followerIds: string[];
  closeFriendIds: string[];
  blockedIds: string[];
  preferencesByUserId: ReadonlyMap<string, NotificationPreferences>;
}): { recipientId: string; type: PostNotificationType }[] {
  const blocked = new Set([...input.blockedIds, input.authorId]);
  const followers = new Set(input.followerIds);
  const closeFriends = new Set(input.closeFriendIds);
  const recipients = new Map<string, PostNotificationType>();

  for (const friendId of closeFriends) {
    if (blocked.has(friendId)) continue;
    const preferences = input.preferencesByUserId.get(friendId) ?? null;
    if (isNotificationEnabled("close_friend_post", preferences)) {
      recipients.set(friendId, "close_friend_post");
    } else if (
      input.visibility === "public" &&
      followers.has(friendId) &&
      isNotificationEnabled("post", preferences)
    ) {
      recipients.set(friendId, "post");
    }
  }

  if (input.visibility === "public") {
    for (const followerId of followers) {
      if (
        !blocked.has(followerId) &&
        !closeFriends.has(followerId) &&
        isNotificationEnabled("post", input.preferencesByUserId.get(followerId) ?? null)
      ) {
        recipients.set(followerId, "post");
      }
    }
  }

  return [...recipients].map(([recipientId, type]) => ({ recipientId, type }));
}