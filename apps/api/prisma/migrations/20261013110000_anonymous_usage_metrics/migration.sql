CREATE TABLE "UsageMetricBucket" (
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UsageMetricBucket_pkey" PRIMARY KEY ("bucket", "metric")
);

CREATE INDEX "UsageMetricBucket_metric_bucket_idx"
    ON "UsageMetricBucket"("metric", "bucket");

CREATE FUNCTION record_usage_metric() RETURNS trigger AS $$
DECLARE
    bucket_start TIMESTAMPTZ(3);
BEGIN
    bucket_start := date_bin(
        INTERVAL '5 minutes',
        CURRENT_TIMESTAMP,
        TIMESTAMPTZ '2000-01-01 00:00:00+00'
    );

    INSERT INTO "UsageMetricBucket" ("bucket", "metric", "count")
    VALUES (bucket_start, TG_ARGV[0], 1)
    ON CONFLICT ("bucket", "metric") DO UPDATE
      SET "count" = "UsageMetricBucket"."count" + 1;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "UsageMetric_User_insert"
    AFTER INSERT ON "User"
    FOR EACH ROW EXECUTE FUNCTION record_usage_metric('users');
CREATE TRIGGER "UsageMetric_Post_insert"
    AFTER INSERT ON "Post"
    FOR EACH ROW EXECUTE FUNCTION record_usage_metric('posts');
CREATE TRIGGER "UsageMetric_Story_insert"
    AFTER INSERT ON "Story"
    FOR EACH ROW EXECUTE FUNCTION record_usage_metric('stories');
CREATE TRIGGER "UsageMetric_Snap_insert"
    AFTER INSERT ON "Snap"
    FOR EACH ROW EXECUTE FUNCTION record_usage_metric('snaps');
CREATE TRIGGER "UsageMetric_MomentPost_insert"
    AFTER INSERT ON "MomentPost"
    FOR EACH ROW EXECUTE FUNCTION record_usage_metric('moments');
CREATE TRIGGER "UsageMetric_Message_insert"
    AFTER INSERT ON "Message"
    FOR EACH ROW EXECUTE FUNCTION record_usage_metric('messages');
CREATE TRIGGER "UsageMetric_Comment_insert"
    AFTER INSERT ON "Comment"
    FOR EACH ROW EXECUTE FUNCTION record_usage_metric('comments');
CREATE TRIGGER "UsageMetric_Follow_insert"
    AFTER INSERT ON "Follow"
    FOR EACH ROW EXECUTE FUNCTION record_usage_metric('follows');

INSERT INTO "UsageMetricBucket" ("bucket", "metric", "count")
VALUES (
    date_bin(
        INTERVAL '5 minutes',
        CURRENT_TIMESTAMP,
        TIMESTAMPTZ '2000-01-01 00:00:00+00'
    ),
    '_tracking_since',
    0
);
