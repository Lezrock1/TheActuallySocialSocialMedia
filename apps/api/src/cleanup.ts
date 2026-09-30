import { prisma } from "./db.js";
import { deleteMedia } from "./storage.js";

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

// Best-effort periodic sweep: removes expired Stories/Snaps and their
// underlying media objects. Fine for a single-instance MVP; a real deployment
// should replace this with a proper scheduled job (e.g. a cron worker).
export async function cleanupExpiredMedia(): Promise<void> {
  const now = new Date();

  const expiredStories = await prisma.story.findMany({
    where: { expiresAt: { lte: now } },
  });
  for (const story of expiredStories) {
    await deleteMedia(story.imageKey);
  }
  if (expiredStories.length > 0) {
    await prisma.story.deleteMany({
      where: { id: { in: expiredStories.map((s) => s.id) } },
    });
  }

  const expiredSnaps = await prisma.snap.findMany({
    where: { expiresAt: { lte: now } },
  });
  for (const snap of expiredSnaps) {
    await deleteMedia(snap.imageKey);
  }
  if (expiredSnaps.length > 0) {
    await prisma.snap.deleteMany({
      where: { id: { in: expiredSnaps.map((s) => s.id) } },
    });
  }
}

export function startCleanupJob(logger: {
  error: (obj: unknown, msg?: string) => void;
}): NodeJS.Timeout {
  return setInterval(() => {
    cleanupExpiredMedia().catch((err) =>
      logger.error(err, "Expired media cleanup failed")
    );
  }, CLEANUP_INTERVAL_MS);
}
