export interface MentionCandidate {
  id: string;
  username: string;
  displayName: string | null;
}

// Prefix matches beat loose matches; among equals, people you follow come first.
export function rankMentionCandidates<T extends MentionCandidate>(
  candidates: T[],
  query: string,
  followedIds: ReadonlySet<string>,
  limit = 6
): T[] {
  const needle = query.toLowerCase();
  const score = (candidate: T): number => {
    const username = candidate.username.toLowerCase();
    const nameWords = (candidate.displayName ?? "").toLowerCase().split(/\s+/);
    let match = 3;
    if (!needle || username === needle) match = 0;
    else if (username.startsWith(needle)) match = 1;
    else if (nameWords.some((word) => word.startsWith(needle))) match = 2;
    return match * 2 + (followedIds.has(candidate.id) ? 0 : 1);
  };
  return [...candidates]
    .sort((a, b) => score(a) - score(b) || a.username.localeCompare(b.username))
    .slice(0, limit);
}
