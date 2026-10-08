export interface QuietHoursConfig {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  timezone: string;
}

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function localMinuteOfDay(date: Date, timezone: string): number {
  const zone = isValidTimeZone(timezone) ? timezone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function isQuietNow(config: QuietHoursConfig, now: Date): boolean {
  if (!config.enabled || config.startMinute === config.endMinute) return false;
  const minute = localMinuteOfDay(now, config.timezone);
  return config.startMinute < config.endMinute
    ? minute >= config.startMinute && minute < config.endMinute
    : minute >= config.startMinute || minute < config.endMinute;
}

// Most recent quiet window that has already ended; null while quiet hours are off or active.
export function lastQuietWindow(
  config: QuietHoursConfig,
  now: Date
): { start: Date; end: Date } | null {
  if (!config.enabled || config.startMinute === config.endMinute || isQuietNow(config, now)) {
    return null;
  }
  const minute = localMinuteOfDay(now, config.timezone);
  const sinceEnd = (minute - config.endMinute + DAY_MINUTES) % DAY_MINUTES;
  const secondsIntoMinute = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const end = new Date(now.getTime() - sinceEnd * MINUTE_MS - secondsIntoMinute);
  const duration = (config.endMinute - config.startMinute + DAY_MINUTES) % DAY_MINUTES;
  return { start: new Date(end.getTime() - duration * MINUTE_MS), end };
}
