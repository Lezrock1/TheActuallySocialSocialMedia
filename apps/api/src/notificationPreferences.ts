import type { NotificationPreferences, NotificationType } from "@app/shared";

const preferenceByType: Record<NotificationType, keyof NotificationPreferences> = {
  post: "postsFromFollowing",
  close_friend_post: "postsFromCloseFriends",
  snap: "snaps",
  message: "messages",
  follow: "follows",
  comment: "comments",
  comment_reply: "commentReplies",
  comment_like: "commentLikes",
  mention: "mentions",
  close_friend: "closeFriends",
};

export function isNotificationEnabled(
  type: NotificationType,
  preferences: NotificationPreferences | null
): boolean {
  return preferences === null || preferences[preferenceByType[type]];
}