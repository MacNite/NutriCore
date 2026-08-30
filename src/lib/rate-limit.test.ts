import { beforeEach, describe, expect, it } from "vitest";
import { pruneRateLimits, rateLimit, resetRateLimits } from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("rate limiting", () => {
  it("allows up to the limit and then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) expect(rateLimit("ip:1", 3, 60_000, now).allowed).toBe(true);
    const blocked = rateLimit("ip:1", 3, 60_000, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("keeps buckets independent per key", () => {
    const now = 1_000_000;
    rateLimit("ip:1", 1, 60_000, now);
    expect(rateLimit("ip:1", 1, 60_000, now).allowed).toBe(false);
    expect(rateLimit("ip:2", 1, 60_000, now).allowed).toBe(true);
  });

  it("reopens the window after it expires", () => {
    const now = 1_000_000;
    rateLimit("ip:1", 1, 60_000, now);
    expect(rateLimit("ip:1", 1, 60_000, now).allowed).toBe(false);
    expect(rateLimit("ip:1", 1, 60_000, now + 60_001).allowed).toBe(true);
  });

  it("prunes expired buckets", () => {
    rateLimit("ip:1", 1, 1_000, 1_000);
    pruneRateLimits(10_000);
    expect(rateLimit("ip:1", 1, 1_000, 10_001).allowed).toBe(true);
  });
});

describe("configurable limits", () => {
  it("keeps production defaults when no multiplier is set", async () => {
    delete process.env.RATE_LIMIT_MULTIPLIER;
    const { RATE_LIMITS } = await import("./rate-limit");
    expect(RATE_LIMITS.register.limit).toBe(5);
    expect(RATE_LIMITS.login.limit).toBe(10);
  });

  it("scales limits for test runs but never below the default", async () => {
    const { RATE_LIMITS } = await import("./rate-limit");
    process.env.RATE_LIMIT_MULTIPLIER = "20";
    expect(RATE_LIMITS.register.limit).toBe(100);
    process.env.RATE_LIMIT_MULTIPLIER = "0.1";
    expect(RATE_LIMITS.register.limit).toBe(5);
    delete process.env.RATE_LIMIT_MULTIPLIER;
  });
});
