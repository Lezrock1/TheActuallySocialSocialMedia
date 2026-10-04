CREATE TABLE "SnapStreak" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastExchangeAt" TIMESTAMP(3),
    "pendingUserAAt" TIMESTAMP(3),
    "pendingUserBAt" TIMESTAMP(3),

    CONSTRAINT "SnapStreak_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SnapStreak_userAId_userBId_key" ON "SnapStreak"("userAId", "userBId");
CREATE INDEX "SnapStreak_userAId_currentStreak_idx" ON "SnapStreak"("userAId", "currentStreak");
CREATE INDEX "SnapStreak_userBId_currentStreak_idx" ON "SnapStreak"("userBId", "currentStreak");

ALTER TABLE "SnapStreak" ADD CONSTRAINT "SnapStreak_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnapStreak" ADD CONSTRAINT "SnapStreak_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;