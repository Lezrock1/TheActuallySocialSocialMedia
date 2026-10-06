import { describe, expect, it } from "vitest";
import { createPushPayload } from "./pushPayload.js";

describe("createPushPayload", () => {
  it("uses a generic message alert and opens the matching conversation", () => {
    const payload = createPushPayload({
      notificationId: "notification-1",
      actorUsername: "alex",
      type: "message",
      conversationId: "conversation/1",
    });

    expect(payload).toEqual({
      title: "InTouch",
      body: "@alex sent you a message",
      url: "/dms?conversation=conversation%2F1",
      tag: "notification-1",
    });
    expect(JSON.stringify(payload)).not.toContain("message text");
  });

  it("never includes Snap content in the alert", () => {
    const payload = createPushPayload({
      notificationId: "notification-2",
      actorUsername: "sam",
      type: "snap",
      snapId: "snap-1",
    });

    expect(payload.body).toBe("@sam sent you a Snap");
    expect(payload.url).toBe("/snaps");
  });

  it("announces story reactions without including story content", () => {
    const payload = createPushPayload({
      notificationId: "notification-3",
      actorUsername: "jules",
      type: "story_reaction",
    });

    expect(payload.body).toBe("@jules reacted to your story");
    expect(payload.url).toBe("/notifications");
  });

  it("opens Live Rooms for a live-room notification", () => {
    const payload = createPushPayload({
      notificationId: "notification-4",
      actorUsername: "taylor",
      type: "live_room",
    });

    expect(payload.body).toBe("@taylor started a Live Room you can join");
    expect(payload.url).toBe("/dms?view=live_rooms");
  });
});