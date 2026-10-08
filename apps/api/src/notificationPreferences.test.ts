import { describe, expect, it } from "vitest";
import type { NotificationPreferences, NotificationType } from "@app/shared";
import { isNotificationEnabled } from "./notificationPreferences.js";

const enabledPreferences: NotificationPreferences = {
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
  quietHoursEnabled: false,
  quietStartMinute: 1320,
  quietEndMinute: 420,
  timezone: "UTC",
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
      "live_room",
      "follow",
      "comment",
      "comment_reply",
      "comment_like",
      "story_reaction",
      "mention",
      "close_friend",
      "circle_post",
      "circle_added",
      "meetup_response",
      "meetup_update",
      "meetup_cancelled",
    ];
    for (const type of notificationTypes) {
      expect(isNotificationEnabled(type, enabledPreferences)).toBe(true);
    }

    expect(isNotificationEnabled("post", { ...enabledPreferences, postsFromFollowing: false })).toBe(false);
    expect(isNotificationEnabled("close_friend_post", { ...enabledPreferences, postsFromCloseFriends: false })).toBe(false);
    expect(isNotificationEnabled("snap", { ...enabledPreferences, snaps: false })).toBe(false);
    expect(isNotificationEnabled("message", { ...enabledPreferences, messages: false })).toBe(false);
    expect(isNotificationEnabled("live_room", { ...enabledPreferences, liveRooms: false })).toBe(false);
    expect(isNotificationEnabled("story_reaction", { ...enabledPreferences, storyReactions: false })).toBe(false);
  });
});