UPDATE "Invitation"
SET "expiresAt" = "createdAt" + INTERVAL '30 days'
WHERE "redeemedAt" IS NULL
  AND "useCount" < "maxUses"
  AND "expiresAt" < "createdAt" + INTERVAL '30 days';