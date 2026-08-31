/**
 * Evenly spaced slots for outbound provider requests.
 *
 * This is the mirror image of `rateLimit`: that one protects NutriCore from
 * its own users and answers "no", this one protects an upstream provider from
 * NutriCore and answers "not yet". Open Food Facts publishes per-minute limits
 * (10/min for search, 100/min for product reads) and answers 429 above them,
 * so pacing our own calls is cheaper than discovering the limit by tripping it.
 *
 * The schedule is the virtual-scheduling (GCRA) one: a single timestamp says
 * when the next slot falls due, and `burst` slots may be taken back to back
 * before callers start waiting. Reserving advances that timestamp, so
 * concurrent callers queue behind each other instead of all seeing "free now".
 */
export class RateGate {
  private theoreticalArrival = 0;

  constructor(
    private readonly emissionIntervalMs: number,
    private readonly burst = 1,
  ) {}

  static perMinute(limit: number, burst = 1) {
    return new RateGate(60_000 / limit, burst);
  }

  /**
   * Reserves the next slot and returns the wait before it, in milliseconds.
   * Returns null - reserving nothing - when that wait exceeds `maxWaitMs`, so
   * a caller can fail fast rather than hold a request open for minutes.
   */
  reserve(maxWaitMs = Number.POSITIVE_INFINITY, now = Date.now()): number | null {
    const arrival = Math.max(this.theoreticalArrival, now);
    const wait = Math.max(0, arrival - (this.burst - 1) * this.emissionIntervalMs - now);
    if (wait > maxWaitMs) return null;
    this.theoreticalArrival = arrival + this.emissionIntervalMs;
    return wait;
  }

  reset() {
    this.theoreticalArrival = 0;
  }
}

export const delay = (ms: number) => (ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms)));

/**
 * Spreads retries of concurrent callers apart. Without it every request that
 * failed in the same upstream outage retries in the same instant.
 */
export const jitter = (ms: number, random = Math.random) => Math.round(ms * (0.75 + random() * 0.5));
