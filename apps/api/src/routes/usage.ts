import type { FastifyInstance } from "fastify";
import type { PublicUsageMetrics, UsageMetricCounts } from "@app/shared";
import { prisma } from "../db.js";
import { createRateLimiter, sendRateLimited } from "../rateLimit.js";

const METRICS = ["users", "posts", "stories", "snaps", "moments", "messages", "comments", "follows"] as const;
const USAGE_METRIC_LIMITER = createRateLimiter({ windowMs: 60_000, max: 30 });
const BUCKET_SIZE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function floorToBucket(date: Date): Date {
  return new Date(Math.floor(date.getTime() / BUCKET_SIZE_MS) * BUCKET_SIZE_MS);
}

function emptyCounts(): UsageMetricCounts {
  return { users: 0, posts: 0, stories: 0, snaps: 0, moments: 0, messages: 0, comments: 0, follows: 0 };
}

function toCounts(rows: Array<{ metric: string; _sum: { count: number | null } }>): UsageMetricCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    if (METRICS.includes(row.metric as (typeof METRICS)[number])) {
      counts[row.metric as keyof UsageMetricCounts] = row._sum.count ?? 0;
    }
  }
  return counts;
}

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/public/usage-metrics", async (request, reply) => {
    const rateLimit = USAGE_METRIC_LIMITER.hit(request.ip);
    if (!rateLimit.allowed) return sendRateLimited(reply, rateLimit.retryAfterSeconds);

    const asOf = floorToBucket(new Date());
    const trackingMarker = await prisma.usageMetricBucket.findFirst({
      where: { metric: "_tracking_since" },
      orderBy: { bucket: "asc" },
      select: { bucket: true },
    });
    const trackingSince = trackingMarker?.bucket ?? asOf;
    const start24Hours = new Date(Math.max(asOf.getTime() - DAY_MS, trackingSince.getTime()));
    const start7Days = new Date(Math.max(asOf.getTime() - 7 * DAY_MS, trackingSince.getTime()));

    const [last24HoursRows, last7DaysRows] = await Promise.all([
      prisma.usageMetricBucket.groupBy({
        by: ["metric"],
        where: { metric: { in: [...METRICS] }, bucket: { gte: start24Hours, lt: asOf } },
        _sum: { count: true },
      }),
      prisma.usageMetricBucket.groupBy({
        by: ["metric"],
        where: { metric: { in: [...METRICS] }, bucket: { gte: start7Days, lt: asOf } },
        _sum: { count: true },
      }),
    ]);

    const result: PublicUsageMetrics = {
      asOf: asOf.toISOString(),
      trackingSince: trackingSince.toISOString(),
      last24Hours: toCounts(last24HoursRows),
      last7Days: toCounts(last7DaysRows),
    };
    return reply.header("Cache-Control", "public, max-age=60").send(result);
  });
}