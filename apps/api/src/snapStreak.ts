export interface SnapStreakState {
  currentStreak: number;
  bestStreak: number;
  lastExchangeAt: Date | null;
  pendingUserAAt: Date | null;
  pendingUserBAt: Date | null;
}

const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const STREAK_EXPIRY_MS = 48 * 60 * 60 * 1000;
const MIN_EXCHANGE_INTERVAL_MS = 20 * 60 * 60 * 1000;

export function recordSnapInStreak(
  state: SnapStreakState,
  sentByUserA: boolean,
  sentAt: Date
): SnapStreakState {
  let currentStreak = state.currentStreak;
  let bestStreak = state.bestStreak;
  let lastExchangeAt = state.lastExchangeAt;
  let pendingUserAAt = state.pendingUserAAt;
  let pendingUserBAt = state.pendingUserBAt;

  if (lastExchangeAt && sentAt.getTime() - lastExchangeAt.getTime() > STREAK_EXPIRY_MS) {
    currentStreak = 0;
    lastExchangeAt = null;
    pendingUserAAt = null;
    pendingUserBAt = null;
  }

  if (sentByUserA) pendingUserAAt = sentAt;
  else pendingUserBAt = sentAt;

  const otherSideAt = sentByUserA ? pendingUserBAt : pendingUserAAt;
  if (otherSideAt && Math.abs(sentAt.getTime() - otherSideAt.getTime()) > RESPONSE_WINDOW_MS) {
    if (sentByUserA) pendingUserBAt = null;
    else pendingUserAAt = null;
  }

  const bothSidesSent = pendingUserAAt !== null && pendingUserBAt !== null;
  const exchangeReady = lastExchangeAt === null ||
    sentAt.getTime() - lastExchangeAt.getTime() >= MIN_EXCHANGE_INTERVAL_MS;
  if (bothSidesSent && exchangeReady) {
    currentStreak = lastExchangeAt ? currentStreak + 1 : 1;
    bestStreak = Math.max(bestStreak, currentStreak);
    lastExchangeAt = sentAt;
    pendingUserAAt = null;
    pendingUserBAt = null;
  }

  return {
    currentStreak,
    bestStreak,
    lastExchangeAt,
    pendingUserAAt,
    pendingUserBAt,
  };
}