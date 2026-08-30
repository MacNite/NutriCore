type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window limiter held in process memory. NutriCore is a single-container
 * self-hosted deployment, so this needs no shared store; a horizontally scaled
 * deployment would swap this for Postgres or Redis.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}

/** Drops expired buckets so a long-running process cannot grow without bound. */
export function pruneRateLimits(now = Date.now()) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

/**
 * Production defaults. `RATE_LIMIT_MULTIPLIER` scales them for end-to-end test
 * runs, which register many accounts from a single address; it is never set in
 * a real deployment.
 */
const multiplier = () => {
  const raw = Number(process.env.RATE_LIMIT_MULTIPLIER ?? "1");
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
};

const scaled = (limit: number, windowMs: number) => ({
  get limit() {
    return Math.ceil(limit * multiplier());
  },
  windowMs,
});

export const RATE_LIMITS = {
  login: scaled(10, 15 * 60 * 1000),
  register: scaled(5, 60 * 60 * 1000),
  search: scaled(120, 60 * 1000),
  research: scaled(10, 60 * 60 * 1000),
  export: scaled(5, 60 * 60 * 1000),
};
