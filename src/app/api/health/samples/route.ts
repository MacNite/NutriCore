import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { clientAddress } from "@/lib/client-address";
import { env } from "@/lib/env";
import { bearerToken } from "@/lib/health-token";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { authenticateDevice, type AuthenticatedDevice, markDeviceUsed } from "@/server/health-device-tokens";
import { ingest, MAX_SYNC_BODY_BYTES, parseSamples, syncCursor } from "@/server/health-import-ingest";
import { durableRateLimitOrFallback } from "@/server/durable-rate-limit";

/**
 * The endpoint a phone syncs health samples to on its own.
 *
 * The settings page already imports an export file, and does it well, but it
 * needs a person: export the file, find it, pick it, confirm. This is the same
 * import without that person - an Apple Shortcut running each morning, or an
 * Android app reading Health Connect on a schedule - so it authenticates with a
 * device token instead of the session cookie.
 *
 * What it is not is a second importer. The samples are validated by the same
 * schema and written by the same planner as the file path; see
 * `src/server/health-import-ingest.ts`. The only thing decided here is who is
 * calling and how loudly they may do it.
 *
 * GET  - where to resume from, per metric.
 * POST - samples, optionally as a dry run.
 *
 * The platform is not in either request: it is fixed by the token, so a
 * credential taken off an iPhone cannot write Health Connect records.
 *
 * There is no same-origin check here, and that is not an omission. This route
 * authenticates by `Authorization` header and never reads the session cookie,
 * so there is nothing for a browser to attach on a victim's behalf: a
 * cross-site request that does not already hold the token gets the same 401 as
 * anyone else. A route that read the cookie would need `assertSameOrigin`; this
 * one would only be able to reject its own legitimate clients, which send no
 * `Origin` at all.
 */

export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

type Authorised = { device: AuthenticatedDevice } | { response: NextResponse };

/**
 * Resolve the bearer token, spending a rate-limit slot either way.
 *
 * The unknown-token limit is per address and the known-token limit is per
 * token. Keeping them apart is what stops a device behind a shared address
 * being locked out by somebody else's broken client, and stops a valid token
 * being a way to spend the address budget.
 */
async function authorise(request: Request): Promise<Authorised> {
  const token = bearerToken(request.headers.get("authorization"));
  const address = clientAddress(await headers(), env().TRUSTED_PROXY_HOPS);

  if (!token) return { response: await refuse(address) };

  const device = await authenticateDevice(token);
  if (!device) return { response: await refuse(address) };

  const limit = rateLimit(`healthSync:${device.id}`, RATE_LIMITS.healthSync.limit, RATE_LIMITS.healthSync.windowMs);
  if (!limit.allowed) return { response: tooManyRequests(limit.retryAfterSeconds) };

  return { device };
}

/**
 * Spend one unknown-token slot for this address and answer accordingly.
 *
 * Durable, because the limits that exist to stop something rather than to be
 * polite have to survive a restart, and a self-hosted box restarts whenever its
 * operator remembers to upgrade. The in-memory limiter is the fallback, and is
 * consulted once so that a database outage costs one slot rather than two.
 */
async function refuse(address: string): Promise<NextResponse> {
  const { limit, windowMs } = RATE_LIMITS.healthSyncUnknown;
  const key = `healthSyncUnknown:${address}`;
  const result = await durableRateLimitOrFallback(key, limit, windowMs, rateLimit(key, limit, windowMs));
  return result.allowed ? unauthorised() : tooManyRequests(result.retryAfterSeconds);
}

/**
 * `WWW-Authenticate` because this is a real bearer scheme and a client library
 * is entitled to be told so. No detail beyond that: a caller learns only that
 * the token did not work, never whether it was absent, malformed or revoked.
 */
const unauthorised = () =>
  NextResponse.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="nutricore"', "Cache-Control": "no-store" } },
  );

const tooManyRequests = (seconds: number) =>
  NextResponse.json(
    { error: "rateLimited", retryAfterSeconds: seconds },
    { status: 429, headers: { "Retry-After": String(Math.max(1, seconds)), "Cache-Control": "no-store" } },
  );

/**
 * Where to resume reading from.
 *
 * A client is free to ignore this and post its whole history - the import is
 * idempotent - but then it moves years of samples to be told it already had
 * them. See `syncCursor` for why the date is inclusive.
 */
export async function GET(request: Request) {
  const auth = await authorise(request);
  if ("response" in auth) return auth.response;

  const metrics = await syncCursor(auth.device.userId, auth.device.platform);

  return json({ device: { name: auth.device.name, platform: auth.device.platform }, metrics }, 200);
}

const REJECTION_STATUS = { validation: 422, tooMany: 413, empty: 422 } as const;

export async function POST(request: Request) {
  const auth = await authorise(request);
  if ("response" in auth) return auth.response;

  /* Refuse an oversized body before reading it, rather than after. See
     `MAX_SYNC_BODY_BYTES` for why this route needs a ceiling of its own. */
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SYNC_BODY_BYTES) return json({ error: "tooMany" }, 413);

  /* A body that is not JSON at all is the same class of problem as a body that
     is JSON of the wrong shape, and gets the same answer. */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation" }, 422);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "validation" }, 422);

  const envelope = body as { samples?: unknown; dryRun?: unknown };
  if (envelope.dryRun !== undefined && typeof envelope.dryRun !== "boolean") return json({ error: "validation" }, 422);

  const parsed = parseSamples(envelope.samples);
  if (!parsed.ok) return json({ error: parsed.error }, REJECTION_STATUS[parsed.error]);

  const dryRun = envelope.dryRun === true;
  const plan = await ingest(auth.device.userId, auth.device.platform, parsed.samples, { dryRun });

  /* Only a real write counts as the device having synced. A dry run that
     refreshed `lastUsedAt` would make a client stuck in preview look healthy. */
  if (!dryRun) await markDeviceUsed(auth.device.id);

  /* `planned` rather than the whole plan: the per-sample decisions run to tens
     of thousands of entries and no client has a use for them. The totals and
     the per-metric breakdown are what a sync log wants. */
  return json(
    {
      dryRun,
      platform: plan.platform,
      totals: plan.totals,
      metrics: plan.metrics,
    },
    200,
  );
}
