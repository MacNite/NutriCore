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
  /* Per-account rather than per-address. The address limit is only as good as
     the deployment's proxy configuration and collapses to one shared bucket
     without one; this one bounds guessing against a single account however the
     attempts are spread across addresses. Tighter than the address limit,
     because ten wrong passwords for one account is already a lot. */
  loginAccount: scaled(8, 15 * 60 * 1000),
  register: scaled(5, 60 * 60 * 1000),
  search: scaled(120, 60 * 1000),
  research: scaled(10, 60 * 60 * 1000),
  export: scaled(5, 60 * 60 * 1000),
  invite: scaled(10, 60 * 60 * 1000),
  /* Redeeming an invitation is unauthenticated and hashes a password, so it is
     limited per address even though the token itself is unguessable. */
  inviteAccept: scaled(10, 60 * 60 * 1000),
  /* A scan carries two images and queues CPU work, so it is limited more
     tightly than a search and more loosely than anything a person waits on. */
  bodyScan: scaled(12, 60 * 60 * 1000),
  /* Publishing writes something every other member of the instance sees, so it
     is the one recipe operation that is limited at all. Generous enough that
     tidying up a batch of recipes never trips it. */
  publish: scaled(30, 60 * 60 * 1000),
  /* Reporting a wrong value writes into shared data on an ordinary member's
     say-so, so it is paced the way publishing a recipe is. Loose enough that
     somebody working through a shelf of badly scanned barcodes never trips it,
     tight enough that a script cannot fill an administrator's queue. */
  foodReport: scaled(30, 60 * 60 * 1000),
  /* A health import writes thousands of rows from one file. The preview and the
     confirm each spend one, so this is roughly a dozen real imports an hour -
     far more than anyone needs, and far less than a loop could do damage with. */
  healthImport: scaled(24, 60 * 60 * 1000),
  /* A phone syncing on a schedule needs a handful of calls a day, and the two
     that matter - read the cursor, post the new samples - come in pairs. This
     is per token, so one misconfigured device cannot spend another's budget,
     and it is loose enough that a client retrying a failed sync every few
     minutes for an hour still gets through. */
  healthSync: scaled(60, 60 * 60 * 1000),
  /* Presenting a token that resolves to nothing. Per address, because there is
     no account to attribute it to, and tight because a correct client never
     does it twice: the token is 256 bits, so this is not guessing protection
     so much as a stop on something looping against the endpoint. */
  healthSyncUnknown: scaled(20, 60 * 60 * 1000),
};
