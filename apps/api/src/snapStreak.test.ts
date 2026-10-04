import { describe, expect, it } from "vitest";
import { recordSnapInStreak } from "./snapStreak.js";
import type { SnapStreakState } from "./snapStreak.js";

const HOUR = 60 * 60 * 1000;
const emptyStreak: SnapStreakState = {
  currentStreak: 0,
  bestStreak: 0,
  lastExchangeAt: null,
  pendingUserAAt: null,
  pendingUserBAt: null,
};

describe("recordSnapInStreak", () => {
  it("starts a streak when the other person replies within 24 hours", () => {
    const firstSnapAt = new Date("2026-10-01T10:00:00Z");
    const waiting = recordSnapInStreak(emptyStreak, true, firstSnapAt);
    const completed = recordSnapInStreak(
      waiting,
      false,
      new Date(firstSnapAt.getTime() + 12 * HOUR)
    );

    expect(completed.currentStreak).toBe(1);
    expect(completed.pendingUserAAt).toBeNull();
    expect(completed.pendingUserBAt).toBeNull();
  });

  it("does not count duplicate snaps or exchanges less than 20 hours apart", () => {
    const firstSnapAt = new Date("2026-10-01T10:00:00Z");
    const waiting = recordSnapInStreak(emptyStreak, true, firstSnapAt);
    const completed = recordSnapInStreak(
      waiting,
      false,
      new Date(firstSnapAt.getTime() + HOUR)
    );
    const nextSideA = recordSnapInStreak(
      completed,
      true,
      new Date(firstSnapAt.getTime() + 2 * HOUR)
    );
    const stillWaiting = recordSnapInStreak(
      nextSideA,
      false,
      new Date(firstSnapAt.getTime() + 3 * HOUR)
    );

    expect(completed.currentStreak).toBe(1);
    expect(stillWaiting.currentStreak).toBe(1);
    expect(stillWaiting.lastExchangeAt).toEqual(completed.lastExchangeAt);
  });

  it("expires after 48 hours without a completed exchange and starts over", () => {
    const firstSnapAt = new Date("2026-10-01T10:00:00Z");
    const waiting = recordSnapInStreak(emptyStreak, true, firstSnapAt);
    const completed = recordSnapInStreak(
      waiting,
      false,
      new Date(firstSnapAt.getTime() + HOUR)
    );
    const late = recordSnapInStreak(
      completed,
      true,
      new Date(firstSnapAt.getTime() + 50 * HOUR)
    );
    const restarted = recordSnapInStreak(
      late,
      false,
      new Date(firstSnapAt.getTime() + 51 * HOUR)
    );

    expect(late.currentStreak).toBe(0);
    expect(restarted.currentStreak).toBe(1);
    expect(restarted.bestStreak).toBe(1);
  });
});