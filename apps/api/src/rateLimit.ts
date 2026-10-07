import type { FastifyReply, FastifyRequest } from "fastify";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Records one hit for the key and reports whether it is within the limit. */
  hit(key: string): RateLimitResult;
  /** Clears the counter, e.g. after a successful login. */
  reset(key: string): void;
  size(): number;
}

// Sliding-window limiter held in memory. Suitable for a single API instance;
// counters reset on restart.
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const { windowMs, max } = options;
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 50_000;
  const hits = new Map<string, number[]>();

  const prune = (): void => {
    const cutoff = now() - windowMs;
    for (const [key, times] of hits) {
      if (times[times.length - 1] <= cutoff) hits.delete(key);
    }
  };
  const timer = setInterval(prune, Math.max(windowMs, 60_000));
  timer.unref();

  return {
    hit(key) {
      const current = now();
      const cutoff = current - windowMs;
      if (!hits.has(key) && hits.size >= maxKeys) prune();
      const times = (hits.get(key) ?? []).filter((time) => time > cutoff);
      if (times.length >= max) {
        hits.set(key, times);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((times[0] + windowMs - current) / 1000)) };
      }
      times.push(current);
      hits.set(key, times);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    reset(key) {
      hits.delete(key);
    },
    size() {
      return hits.size;
    },
  };
}

export function sendRateLimited(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header("Retry-After", String(retryAfterSeconds))
    .send({ error: "Too many requests. Please try again later." });
}

type KeyFn = (request: FastifyRequest) => string | undefined;

/** Fastify preHandler that rejects with 429 once the key exceeds the limit. */
export function rateLimitBy(limiter: RateLimiter, keyFn: KeyFn) {
  return async function rateLimitHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = keyFn(request);
    if (!key) return;
    const result = limiter.hit(key);
    if (!result.allowed) sendRateLimited(reply, result.retryAfterSeconds);
  };
}

export const byIp: KeyFn = (request) => request.ip;
export const byUser: KeyFn = (request) => request.userId;
