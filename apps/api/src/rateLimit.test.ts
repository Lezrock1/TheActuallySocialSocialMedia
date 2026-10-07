import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

describe("createRateLimiter", () => {
  it("blocks after max hits and recovers when the window slides", () => {
    let time = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => time });
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(true);
    const blocked = limiter.hit("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    time = 1001;
    expect(limiter.hit("a").allowed).toBe(true);
  });

  it("tracks keys independently and supports reset", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => 0 });
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
    limiter.reset("a");
    expect(limiter.hit("a").allowed).toBe(true);
  });

  it("does not grow beyond maxKeys with expired entries", () => {
    let time = 0;
    const limiter = createRateLimiter({ windowMs: 10, max: 1, now: () => time, maxKeys: 3 });
    limiter.hit("a");
    limiter.hit("b");
    limiter.hit("c");
    time = 100;
    limiter.hit("d");
    expect(limiter.size()).toBe(1);
  });
});
