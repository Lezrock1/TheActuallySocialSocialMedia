import type { NotificationPreferences, NotificationType } from "@app/shared";

type BooleanPreferenceKey = {
  [K in keyof NotificationPreferences]: NotificationPreferences[K] extends boolean ? K : never;
}[keyof NotificationPreferences];

const preferenceByType: Record<NotificationType, BooleanPreferenceKey> = {
  post: "postsFromFollowing",
  close_friend_post: "postsFromCloseFriends",
  snap: "snaps",
  message: "messages",
  live_room: "liveRooms",
  follow: "follows",
  comment: "comments",
  comment_reply: "commentReplies",
  comment_like: "commentLikes",
  story_reaction: "storyReactions",
  mention: "mentions",
  close_friend: "closeFriends",
  circle_post: "postsFromCircles",
  circle_added: "circles",
  meetup_response: "meetupResponses",
  meetup_update: "meetupUpdates",
  meetup_cancelled: "meetupUpdates",
};

export const notificationPreferenceSelect = {
  postsFromFollowing: true,
  postsFromCloseFriends: true,
  snaps: true,
  messages: true,
  liveRooms: true,
  follows: true,
  comments: true,
  commentReplies: true,
  commentLikes: true,
  storyReactions: true,
  mentions: true,
  closeFriends: true,
  postsFromCircles: true,
  circles: true,
  meetupResponses: true,
  meetupUpdates: true,
  quietHoursEnabled: true,
  quietStartMinute: true,
  quietEndMinute: true,
  timezone: true,
} as const;

export function isNotificationEnabled(
  type: NotificationType,
  preferences: NotificationPreferences | null
): boolean {
  return preferences === null || preferences[preferenceByType[type]];
}