import { prisma } from "./db.js";
import { lastQuietWindow } from "./quietHours.js";
import { sendQuietHoursDigest } from "./pushNotifications.js";

const DIGEST_INTERVAL_MS = 60 * 1000;

export async function runQuietHoursDigests(now = new Date()): Promise<void> {
  const candidates = await prisma.notificationPreference.findMany({
    where: { quietHoursEnabled: true, user: { pushSubscriptions: { some: {} } } },
    select: {
      userId: true,
      quietStartMinute: true,
      quietEndMinute: true,
      timezone: true,
      quietDigestSentAt: true,
    },
  });

  for (const candidate of candidates) {
    const window = lastQuietWindow({
      enabled: true,
      startMinute: candidate.quietStartMinute,
      endMinute: candidate.quietEndMinute,
      timezone: candidate.timezone,
    }, now);
    if (!window) continue;
    const previous = candidate.quietDigestSentAt;
    if (previous && previous >= window.end) continue;

    // Atomic claim so overlapping runs never send the digest twice.
    const claim = await prisma.notificationPreference.updateMany({
      where: {
        userId: candidate.userId,
        quietHoursEnabled: true,
        quietStartMinute: candidate.quietStartMinute,
        quietEndMinute: candidate.quietEndMinute,
        timezone: candidate.timezone,
        OR: [{ quietDigestSentAt: null }, { quietDigestSentAt: { lt: window.end } }],
      },
      data: { quietDigestSentAt: now },
    });
    if (claim.count !== 1) continue;

    // Anything created before the settings were saved was pushed normally.
    const from = previous && previous > window.start ? previous : window.start;
    const count = await prisma.notification.count({
      where: {
        recipientId: candidate.userId,
        createdAt: { gte: from, lt: window.end },
      },
    });
    await sendQuietHoursDigest(candidate.userId, count);
  }
}

export function startQuietHoursDigestJob(logger: {
  error: (obj: unknown, msg?: string) => void;
}): NodeJS.Timeout {
  return setInterval(() => {
    runQuietHoursDigests().catch((err) => logger.error(err, "Quiet hours digest failed"));
  }, DIGEST_INTERVAL_MS);
}
