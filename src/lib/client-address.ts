/**
 * The client address to throttle on, read from the right of the proxy chain.
 *
 * Lives in `lib` rather than beside the actions that use it because
 * `auth-actions.ts` is a `"use server"` module, and every export of one of
 * those has to be an async function that the framework may expose as an
 * endpoint. A pure helper does not belong in that contract.
 *
 * This used to take the *first* `X-Forwarded-For` entry with no notion of which
 * proxies were trusted, which made the rate-limit key attacker-chosen: anyone
 * talking to the app directly could put a fresh fabricated address in that
 * header on every request and never hit a limit at all.
 *
 * `X-Forwarded-For` is append-only, so entries a client forges can only ever be
 * to the *left* of the ones the infrastructure adds. Counting `hops` from the
 * right therefore lands on an entry written by a proxy rather than by the
 * caller. `hops` must be the number of proxies that append to the header, and
 * the outermost one has to strip any inbound `X-Forwarded-For`, or its entry is
 * one the client supplied.
 *
 * The default is 0 - the header is not trusted at all - because the stock
 * Compose stack publishes its own port with no proxy in front. That collapses
 * every direct caller into one bucket, which throttles a shared limit rather
 * than no limit; the per-account limit in `loginAction` is what keeps that from
 * being the only defence.
 */
export function clientAddress(headerList: { get(name: string): string | null }, hops: number): string {
  if (hops < 1) return "direct";
  const chain = (headerList.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Fewer entries than configured hops means the request did not arrive through
  // the expected chain. Trusting the leftmost one here is exactly the original
  // bug, so it is refused instead.
  return chain.length >= hops ? chain[chain.length - hops] : "unverified";
}

