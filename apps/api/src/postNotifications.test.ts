import { describe, expect, it } from "vitest";
import type { NotificationPreferences } from "@app/shared";
import { selectPostNotificationRecipients } from "./postNotifications.js";

const allEnabled: NotificationPreferences = {
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

describe("selectPostNotificationRecipients", () => {
  it("notifies followers and close friends once, excluding blocked users", () => {
    const recipients = selectPostNotificationRecipients({
      authorId: "author",
      visibility: "public",
      followerIds: ["follower", "overlap", "blocked", "author"],
      closeFriendIds: ["close-friend", "overlap", "blocked"],
      blockedIds: ["blocked"],
      preferencesByUserId: new Map(),
    });

    expect(recipients).toEqual([
      { recipientId: "close-friend", type: "close_friend_post" },
      { recipientId: "overlap", type: "close_friend_post" },
      { recipientId: "follower", type: "post" },
    ]);
  });

  it("falls back to follow alerts for public posts, but never for close-friends-only posts", () => {
    const preferences = new Map([
      ["overlap", { ...allEnabled, postsFromCloseFriends: false }],
    ]);
    const sharedInput = {
      authorId: "author",
      followerIds: ["overlap"],
      closeFriendIds: ["overlap"],
      blockedIds: [],
      preferencesByUserId: preferences,
    };

    expect(selectPostNotificationRecipients({ ...sharedInput, visibility: "public" })).toEqual([
      { recipientId: "overlap", type: "post" },
    ]);
    expect(selectPostNotificationRecipients({ ...sharedInput, visibility: "close_friends" })).toEqual([]);
  });
});