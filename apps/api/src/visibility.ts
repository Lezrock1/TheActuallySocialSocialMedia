import { prisma } from "./db.js";

export async function getBlockedUserIds(userId: string): Promise<string[]> {
  const [blocking, blockedBy] = await Promise.all([
    prisma.blockedUser.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    }),
    prisma.blockedUser.findMany({
      where: { blockedId: userId },
      select: { blockerId: true },
    }),
  ]);
  return [
    ...blocking.map((b) => b.blockedId),
    ...blockedBy.map((b) => b.blockerId),
  ];
}

// Authors who have added `viewerId` as one of their close friends, i.e. whose
// close_friends-only content the viewer is allowed to see.
export async function getCloseFriendGrantedAuthorIds(
  viewerId: string
): Promise<string[]> {
  const rows = await prisma.closeFriend.findMany({
    where: { friendId: viewerId },
    select: { ownerId: true },
  });
  return rows.map((r) => r.ownerId);
}

export async function isBlocked(
  userAId: string,
  userBId: string
): Promise<boolean> {
  const row = await prisma.blockedUser.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
  });
  return !!row;
}
