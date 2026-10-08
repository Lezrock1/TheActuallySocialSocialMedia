import type { NotificationType } from "@app/shared";

export interface PushPayloadInput {
  notificationId: string;
  actorUsername: string;
  type: NotificationType;
  postId?: string;
  conversationId?: string;
  snapId?: string;
}

const activityText: Record<NotificationType, string> = {
  post: "shared a new post",
  close_friend_post: "shared a new post with close friends",
  follow: "started following you",
  comment: "commented on your post",
  comment_reply: "replied to your comment",
  comment_like: "liked your comment",
  story_reaction: "reacted to your story",
  mention: "mentioned you",
  message: "sent you a message",
  live_room: "started a Live Room you can join",
  snap: "sent you a Snap",
  close_friend: "added you as a close friend",
  circle_post: "shared a new post with a circle you're in",
  circle_added: "added you to a circle",
  meetup_response: "is going to your meetup",
  meetup_update: "updated a meetup you joined",
  meetup_cancelled: "cancelled a meetup you joined",
};

export function createPushPayload(input: PushPayloadInput) {
  const url = input.type === "live_room"
    ? "/dms?view=live_rooms"
    : input.conversationId
    ? `/dms?conversation=${encodeURIComponent(input.conversationId)}`
    : input.snapId
      ? "/snaps"
      : input.postId
        ? `/post/${encodeURIComponent(input.postId)}`
        : "/notifications";

  return {
    title: "InTouch",
    body: `@${input.actorUsername} ${activityText[input.type]}`,
    url,
    tag: input.notificationId,
  };
}