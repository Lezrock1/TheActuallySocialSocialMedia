import type { Server } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), emit: vi.fn(), push: vi.fn(), silentPush: vi.fn() }));
vi.mock("./db.js", () => ({ prisma: {
  $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation({ notification: { findMany: mocks.find, updateMany: mocks.update } }),
} }));
vi.mock("./realtime.js", () => ({ emitToUsers: mocks.emit }));
vi.mock("./visibility.js", () => ({ getBlockedUserIds: vi.fn() }));
vi.mock("./pushNotifications.js", () => ({ sendWebPushNotification: mocks.push, dismissWebPushNotifications: mocks.silentPush }));
import { completeUserNotifications } from "./notifications.js";

describe("notification completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue([{ id: "notice" }]);
    mocks.update.mockResolvedValue({ count: 1 });
  });

  it("synchronizes dismissal over sockets without a silent push that can revoke permission", async () => {
    const io = {} as Server;
    expect(await completeUserNotifications(io, "viewer", { conversationId: "chat" })).toBe(1);
    expect(mocks.emit).toHaveBeenCalledWith(io, ["viewer"], "notifications:cleared", { ids: ["notice"] });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: { in: ["notice"] }, recipientId: "viewer" }, data: { readAt: expect.any(Date), dismissedAt: expect.any(Date) } });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.silentPush).not.toHaveBeenCalled();
  });

  it("does not send anything when no notifications were completed", async () => {
    mocks.find.mockResolvedValue([]);
    expect(await completeUserNotifications({} as Server, "viewer", {})).toBe(0);
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.silentPush).not.toHaveBeenCalled();
  });
});