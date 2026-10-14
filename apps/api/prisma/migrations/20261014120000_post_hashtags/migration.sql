ALTER TABLE "Post" ADD COLUMN "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Post" SET "hashtags" = ARRAY(
  SELECT DISTINCT lower(normalize(found[2], NFC))
  FROM regexp_matches(
    regexp_replace(COALESCE("Post"."text", ''), 'https?://[^[:space:]<>]+|www\.[^[:space:]<>]+', ' ', 'gi'),
    '(^|[^[:alnum:]_])#([[:alnum:]_]{1,64})', 'g'
  ) AS found
);
CREATE INDEX "Post_hashtags_idx" ON "Post" USING GIN ("hashtags");