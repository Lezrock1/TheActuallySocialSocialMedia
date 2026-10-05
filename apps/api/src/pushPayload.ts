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
  follow: "started following you",
  comment: "commented on your post",
  comment_reply: "replied to your comment",
  comment_like: "liked your comment",
  mention: "mentioned you",
  message: "sent you a message",
  snap: "sent you a Snap",
  close_friend: "added you as a close friend",
};

export function createPushPayload(input: PushPayloadInput) {
  const url = input.conversationId
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