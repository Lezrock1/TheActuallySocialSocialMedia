import { prisma } from "./db.js";
import { getBlockedUserIds, getCloseFriendGrantedAuthorIds, getViewerCircleIds } from "./visibility.js";

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
  const [asset, posts, stories, snaps, avatarOwners, messages] = await Promise.all([
    prisma.mediaAsset.findUnique({
      where: { key },
      select: { ownerId: true },
    }),
    prisma.post.findMany({
      where: { imageKey: key },
      select: { authorId: true, visibility: true, circleId: true },
    }),
    prisma.story.findMany({
      where: { OR: [{ imageKey: key }, { audioKey: key }] },
      select: { authorId: true, visibility: true, circleId: true, expiresAt: true },
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
    prisma.message.findMany({
      where: { mediaKey: key },
      select: {
        conversation: {
          select: { members: { where: { userId: viewerId }, select: { id: true } } },
        },
      },
    }),
  ]);

  const hasReferences =
    posts.length > 0 || stories.length > 0 || snaps.length > 0 || avatarOwners.length > 0 ||
    messages.length > 0;
  if (asset?.ownerId === viewerId && !hasReferences) {
    return { allowed: true, maxAgeSeconds: 30 };
  }

  const [blockedIds, closeFriendAuthorIds, circleIds] = await Promise.all([
    getBlockedUserIds(viewerId),
    getCloseFriendGrantedAuthorIds(viewerId),
    getViewerCircleIds(viewerId),
  ]);
  const canSeeAuthor = (authorId: string, visibility: string, circleId: string | null = null): boolean => {
    if (authorId === viewerId) return true;
    if (blockedIds.includes(authorId)) return false;
    if (visibility === "public") return true;
    if (visibility === "circle") return !!circleId && circleIds.includes(circleId);
    return visibility === "close_friends" && closeFriendAuthorIds.includes(authorId);
  };

  const canReadPost = posts.some((post) => canSeeAuthor(post.authorId, post.visibility, post.circleId));
  const canReadStory = stories.some(
    (story) => story.expiresAt > now && canSeeAuthor(story.authorId, story.visibility, story.circleId)
  );
  const canReadMessage = messages.some((message) => message.conversation.members.length > 0);
  const canReadSnap = snaps.some(
    (snap) => snap.expiresAt > now &&
      !blockedIds.includes(snap.senderId) &&
      snap.recipients.length > 0
  );
  const canReadAvatar = avatarOwners.some((avatar) => canSeeAuthor(avatar.id, "public"));
  const allowed = canReadPost || canReadStory || canReadSnap || canReadAvatar || canReadMessage;
  if (!allowed || canReadSnap) return { allowed, maxAgeSeconds: 0 };

  // Voice messages are immutable ciphertext, so members may cache them.
  const onlyMessage = messages.length > 0 && posts.length === 0 && stories.length === 0 && !canReadAvatar;
  if (onlyMessage) return { allowed: true, maxAgeSeconds: AVATAR_MAX_AGE_SECONDS };

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
