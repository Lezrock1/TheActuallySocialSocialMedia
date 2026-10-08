import { describe, expect, it } from "vitest";
import { isQuietNow, lastQuietWindow, type QuietHoursConfig } from "./quietHours.js";

const overnight: QuietHoursConfig = {
  enabled: true,
  startMinute: 22 * 60,
  endMinute: 7 * 60,
  timezone: "Europe/Berlin",
};

describe("quiet hours", () => {
  it("is quiet across midnight in the user's timezone", () => {
    // 23:30 Berlin (CEST, UTC+2) = 21:30 UTC
    expect(isQuietNow(overnight, new Date("2026-10-08T21:30:00Z"))).toBe(true);
    // 06:59 Berlin = 04:59 UTC
    expect(isQuietNow(overnight, new Date("2026-10-09T04:59:00Z"))).toBe(true);
    // 07:00 Berlin = 05:00 UTC
    expect(isQuietNow(overnight, new Date("2026-10-09T05:00:00Z"))).toBe(false);
    // 12:00 Berlin
    expect(isQuietNow(overnight, new Date("2026-10-08T10:00:00Z"))).toBe(false);
  });

  it("supports same-day windows and disabled or empty windows", () => {
    const afternoon = { ...overnight, startMinute: 13 * 60, endMinute: 15 * 60, timezone: "UTC" };
    expect(isQuietNow(afternoon, new Date("2026-10-08T14:00:00Z"))).toBe(true);
    expect(isQuietNow(afternoon, new Date("2026-10-08T15:00:00Z"))).toBe(false);
    expect(isQuietNow({ ...afternoon, enabled: false }, new Date("2026-10-08T14:00:00Z"))).toBe(false);
    expect(isQuietNow({ ...afternoon, endMinute: 13 * 60 }, new Date("2026-10-08T14:00:00Z"))).toBe(false);
  });

  it("falls back to UTC for an unknown timezone", () => {
    const config = { ...overnight, timezone: "Not/AZone" };
    expect(isQuietNow(config, new Date("2026-10-08T23:00:00Z"))).toBe(true);
  });

  it("reports the window that just ended", () => {
    // 07:10 Berlin on Oct 9 = 05:10 UTC
    const window = lastQuietWindow(overnight, new Date("2026-10-09T05:10:30Z"));
    expect(window?.end.toISOString()).toBe("2026-10-09T05:00:00.000Z");
    expect(window?.start.toISOString()).toBe("2026-10-08T20:00:00.000Z");
  });

  it("has no finished window while quiet or disabled", () => {
    expect(lastQuietWindow(overnight, new Date("2026-10-08T21:30:00Z"))).toBeNull();
    expect(lastQuietWindow({ ...overnight, enabled: false }, new Date("2026-10-09T05:10:00Z"))).toBeNull();
  });
});
