import { prisma } from "./db.js";
import { deleteMediaIfUnreferenced, purgeQueuedMediaDeletions } from "./storage.js";

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

// Best-effort periodic sweep: removes expired Stories/Snaps and their
// underlying media objects. Fine for a single-instance MVP; a real deployment
// should replace this with a proper scheduled job (e.g. a cron worker).
export async function cleanupExpiredMedia(): Promise<void> {
  const now = new Date();

  const expiredStories = await prisma.story.findMany({
    where: { expiresAt: { lte: now } },
  });
  if (expiredStories.length > 0) {
    await prisma.story.deleteMany({
      where: { id: { in: expiredStories.map((s) => s.id) } },
    });
  }

  const expiredSnaps = await prisma.snap.findMany({
    where: { expiresAt: { lte: now } },
  });
  if (expiredSnaps.length > 0) {
    await prisma.snap.deleteMany({
      where: { id: { in: expiredSnaps.map((s) => s.id) } },
    });
  }

  const expiredKeys = new Set([
    ...expiredStories.map((story) => story.imageKey),
    ...expiredStories.flatMap((story) => (story.audioKey ? [story.audioKey] : [])),
    ...expiredStories.flatMap((story) => (story.videoKey ? [story.videoKey] : [])),
    ...expiredSnaps.map((snap) => snap.imageKey),
  ]);
  for (const key of expiredKeys) {
    await deleteMediaIfUnreferenced(key);
  }
  await purgeQueuedMediaDeletions();
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
