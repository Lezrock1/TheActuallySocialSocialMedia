import { randomInt } from "node:crypto";
import type { Moment } from "@prisma/client";
import { prisma } from "./db.js";
import { sendMomentPushToEveryone } from "./pushNotifications.js";

// The surprise lands somewhere in this UTC window (about 10:00-21:00 in Central Europe).
const MOMENT_EARLIEST_HOUR_UTC = 8;
const MOMENT_LATEST_HOUR_UTC = 19;
const HOUR_MS = 60 * 60 * 1000;

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// Picks today's random time once; nothing is scheduled when the day's window has already passed.
export async function ensureTodayMoment(now = new Date()): Promise<Moment | null> {
  const day = utcDayKey(now);
  const existing = await prisma.moment.findUnique({ where: { day } });
  if (existing) return existing;

  const start = dayStartMs(day);
  const earliest = Math.max(start + MOMENT_EARLIEST_HOUR_UTC * HOUR_MS, now.getTime() + 60_000);
  const latest = start + MOMENT_LATEST_HOUR_UTC * HOUR_MS;
  if (earliest >= latest) return null;

  const startsAt = new Date(earliest + randomInt(0, latest - earliest));
  try {
    return await prisma.moment.create({ data: { day, startsAt } });
  } catch (error) {
    if (isUniqueViolation(error)) return prisma.moment.findUnique({ where: { day } });
    throw error;
  }
}

async function tick(logger: { error: (error: unknown, message: string) => void }): Promise<void> {
  const now = new Date();
  const moment = await ensureTodayMoment(now);
  if (!moment || moment.startsAt > now || moment.notifiedAt) return;
  // Only the process that flips notifiedAt sends the push.
  const claimed = await prisma.moment.updateMany({
    where: { id: moment.id, notifiedAt: null },
    data: { notifiedAt: now },
  });
  if (claimed.count === 1) {
    await sendMomentPushToEveryone().catch((error) => logger.error(error, "Moment push failed"));
  }
}

export function startMomentJob(logger: { error: (error: unknown, message: string) => void }): NodeJS.Timeout {
  const run = () => void tick(logger).catch((error) => logger.error(error, "Moment job failed"));
  run();
  return setInterval(run, 30_000);
}
