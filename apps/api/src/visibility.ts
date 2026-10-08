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

export async function getViewerCircleIds(viewerId: string): Promise<string[]> {
  const rows = await prisma.circleMember.findMany({
    where: { userId: viewerId },
    select: { circleId: true },
  });
  return rows.map((row) => row.circleId);
}

export interface VisibilityGrants {
  closeFriendAuthorIds: string[];
  circleIds: string[];
}

export async function getVisibilityGrants(viewerId: string): Promise<VisibilityGrants> {
  const [closeFriendAuthorIds, circleIds] = await Promise.all([
    getCloseFriendGrantedAuthorIds(viewerId),
    getViewerCircleIds(viewerId),
  ]);
  return { closeFriendAuthorIds, circleIds };
}

// Prisma OR-clauses for content (posts/stories) the viewer may see from followed authors.
export function visibleContentClauses(viewerId: string, grants: VisibilityGrants) {
  return [
    { visibility: "public" },
    { authorId: viewerId },
    { visibility: "close_friends", authorId: { in: grants.closeFriendAuthorIds } },
    { visibility: "circle", circleId: { in: grants.circleIds } },
  ];
}

// Circle content is visible to members even when they do not follow the owner.
export function circleMemberClause(grants: VisibilityGrants, blockedIds: string[]) {
  return {
    visibility: "circle",
    circleId: { in: grants.circleIds },
    authorId: { notIn: blockedIds },
  };
}

export async function canViewContent(
  viewerId: string,
  content: { authorId: string; visibility: string; circleId: string | null }
): Promise<boolean> {
  if (content.authorId === viewerId) return true;
  if (await isBlocked(viewerId, content.authorId)) return false;
  if (content.visibility === "public") return true;
  if (content.visibility === "close_friends") {
    return !!(await prisma.closeFriend.findUnique({
      where: { ownerId_friendId: { ownerId: content.authorId, friendId: viewerId } },
      select: { id: true },
    }));
  }
  if (content.visibility === "circle" && content.circleId) {
    return !!(await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId: content.circleId, userId: viewerId } },
      select: { id: true },
    }));
  }
  return false;
}

export async function canViewPostById(viewerId: string, postId: string): Promise<boolean> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { authorId: true, visibility: true, circleId: true },
  });
  return !!post && canViewContent(viewerId, post);
}
