import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ prisma: { moment: { findFirst: vi.fn(), deleteMany: vi.fn() }, momentPost: { findMany: vi.fn() } } }));
vi.mock("./pushNotifications.js", () => ({ sendMomentPushToEveryone: vi.fn() }));
vi.mock("./storage.js", () => ({ deleteMediaIfUnreferenced: vi.fn().mockResolvedValue(undefined) }));
import { prisma } from "./db.js";
import { deletePastMoments, visibleMoment } from "./moments.js";
import { deleteMediaIfUnreferenced } from "./storage.js";

describe("Moment expiry follows the next drop, not midnight", () => {
  const now = new Date("2026-10-19T08:00:00Z");
  const yesterday = { id: "previous", day: "2026-10-18", startsAt: new Date("2026-10-18T16:00:00Z"), notifiedAt: null };
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(prisma.momentPost.findMany).mockResolvedValue([]); });
  it("selects the most recent already started drop", async () => {
    vi.mocked(prisma.moment.findFirst).mockResolvedValue(yesterday);
    expect(await visibleMoment(now)).toEqual(yesterday);
    expect(prisma.moment.findFirst).toHaveBeenCalledWith({ where: { startsAt: { lte: now } }, orderBy: [{ startsAt: "desc" }, { day: "desc" }] });
  });
  it("preserves yesterday while today's drop is pending", async () => {
    vi.mocked(prisma.moment.findFirst).mockResolvedValue(yesterday);
    await deletePastMoments(now, { error: vi.fn() });
    expect(prisma.moment.deleteMany).toHaveBeenCalledWith({ where: { startsAt: { lt: yesterday.startsAt } } });
  });
  it("expires the previous media only when a newer drop is active", async () => {
    const current = { ...yesterday, id: "current", startsAt: new Date("2026-10-19T07:00:00Z") };
    vi.mocked(prisma.moment.findFirst).mockResolvedValue(current);
    vi.mocked(prisma.momentPost.findMany).mockResolvedValue([{ imageKey: "old-media" }] as never);
    await deletePastMoments(now, { error: vi.fn() });
    expect(prisma.moment.deleteMany).toHaveBeenCalledWith({ where: { startsAt: { lt: current.startsAt } } });
    expect(deleteMediaIfUnreferenced).toHaveBeenCalledWith("old-media");
  });
  it("deletes nothing when no drop has started", async () => {
    vi.mocked(prisma.moment.findFirst).mockResolvedValue(null);
    await deletePastMoments(now, { error: vi.fn() });
    expect(prisma.moment.deleteMany).not.toHaveBeenCalled();
  });
});