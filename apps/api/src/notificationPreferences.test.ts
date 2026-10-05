import { describe, expect, it } from "vitest";
import type { NotificationPreferences, NotificationType } from "@app/shared";
import { isNotificationEnabled } from "./notificationPreferences.js";

const enabledPreferences: NotificationPreferences = {
  postsFromFollowing: true,
  postsFromCloseFriends: true,
  snaps: true,
  messages: true,
  follows: true,
  comments: true,
  commentReplies: true,
  commentLikes: true,
  mentions: true,
  closeFriends: true,
};

describe("isNotificationEnabled", () => {
  it("keeps notifications enabled for users without saved preferences", () => {
    expect(isNotificationEnabled("message", null)).toBe(true);
  });

  it("maps each notification type to its preference", () => {
    const notificationTypes: NotificationType[] = [
      "post",
      "close_friend_post",
      "snap",
      "message",
      "follow",
      "comment",
      "comment_reply",
      "comment_like",
      "mention",
      "close_friend",
    ];
    for (const type of notificationTypes) {
      expect(isNotificationEnabled(type, enabledPreferences)).toBe(true);
    }

    expect(isNotificationEnabled("post", { ...enabledPreferences, postsFromFollowing: false })).toBe(false);
    expect(isNotificationEnabled("close_friend_post", { ...enabledPreferences, postsFromCloseFriends: false })).toBe(false);
    expect(isNotificationEnabled("snap", { ...enabledPreferences, snaps: false })).toBe(false);
    expect(isNotificationEnabled("message", { ...enabledPreferences, messages: false })).toBe(false);
  });
});