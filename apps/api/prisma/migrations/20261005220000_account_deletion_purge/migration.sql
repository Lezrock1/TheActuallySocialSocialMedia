CREATE TABLE "MediaDeletion" (
    "key" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MediaDeletion_pkey" PRIMARY KEY ("key")
);