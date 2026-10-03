import { prisma } from "./db.js";
import { getBlockedUserIds, getCloseFriendGrantedAuthorIds } from "./visibility.js";

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
): Promise<boolean> {
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
    return true;
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

  if (posts.some((post) => canSeeAuthor(post.authorId, post.visibility))) {
    return true;
  }
  if (
    stories.some(
      (story) =>
        story.expiresAt > now && canSeeAuthor(story.authorId, story.visibility)
    )
  ) {
    return true;
  }
  if (
    snaps.some(
      (snap) =>
        snap.expiresAt > now &&
        !blockedIds.includes(snap.senderId) &&
        snap.recipients.length > 0
    )
  ) {
    return true;
  }
  return avatarOwners.some((avatar) => canSeeAuthor(avatar.id, "public"));
}
