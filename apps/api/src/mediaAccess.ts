import { prisma } from "./db.js";
import { getBlockedUserIds, getCloseFriendGrantedAuthorIds } from "./visibility.js";

const AVATAR_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface MediaAccess {
  allowed: boolean;
  maxAgeSeconds: number;
}

export async function ownsMedia(userId: string, key: string): Promise<boolean> {
  const asset = await prisma.mediaAsset.findUnique({
    where: { key },
    select: { ownerId: true },
  });
  return asset?.ownerId === userId;
}

export async function canReadMedia(
  viewerId: string,
  key: string
): Promise<MediaAccess> {
  const now = new Date();
  const [asset, posts, stories, snaps, avatarOwners] = await Promise.all([
    prisma.mediaAsset.findUnique({
      where: { key },
      select: { ownerId: true },
    }),
    prisma.post.findMany({
      where: { imageKey: key },
      select: { authorId: true, visibility: true },
    }),
    prisma.story.findMany({
      where: { imageKey: key },
      select: { authorId: true, visibility: true, expiresAt: true },
    }),
    prisma.snap.findMany({
      where: { imageKey: key },
      select: {
        senderId: true,
        expiresAt: true,
        recipients: {
          where: { userId: viewerId, viewedAt: null },
          select: { id: true },
        },
      },
    }),
    prisma.user.findMany({
      where: { avatarKey: key },
      select: { id: true },
    }),
  ]);

  const hasReferences =
    posts.length > 0 || stories.length > 0 || snaps.length > 0 || avatarOwners.length > 0;
  if (asset?.ownerId === viewerId && !hasReferences) {
    return { allowed: true, maxAgeSeconds: 30 };
  }

  const [blockedIds, closeFriendAuthorIds] = await Promise.all([
    getBlockedUserIds(viewerId),
    getCloseFriendGrantedAuthorIds(viewerId),
  ]);
  const canSeeAuthor = (authorId: string, visibility: string): boolean => {
    if (authorId === viewerId) return true;
    if (blockedIds.includes(authorId)) return false;
    if (visibility === "public") return true;
    return visibility === "close_friends" && closeFriendAuthorIds.includes(authorId);
  };

  const canReadPost = posts.some((post) => canSeeAuthor(post.authorId, post.visibility));
  const canReadStory = stories.some(
    (story) => story.expiresAt > now && canSeeAuthor(story.authorId, story.visibility)
  );
  const canReadSnap = snaps.some(
    (snap) => snap.expiresAt > now &&
      !blockedIds.includes(snap.senderId) &&
      snap.recipients.length > 0
  );
  const canReadAvatar = avatarOwners.some((avatar) => canSeeAuthor(avatar.id, "public"));
  const allowed = canReadPost || canReadStory || canReadSnap || canReadAvatar;
  if (!allowed || canReadSnap) return { allowed, maxAgeSeconds: 0 };

  // Avatar keys are replaced on change, so avatar-only media can be cached for a day.
  const onlyAvatar = avatarOwners.length > 0 && posts.length === 0 && stories.length === 0;
  if (onlyAvatar) return { allowed: true, maxAgeSeconds: AVATAR_MAX_AGE_SECONDS };

  const activeStoryExpiries = stories
    .map((story) => story.expiresAt.getTime())
    .filter((expiresAt) => expiresAt > now.getTime());
  const maxAgeSeconds = activeStoryExpiries.length
    ? Math.max(0, Math.min(30, Math.floor((Math.min(...activeStoryExpiries) - now.getTime()) / 1000)))
    : 30;
  return { allowed: true, maxAgeSeconds };
}
