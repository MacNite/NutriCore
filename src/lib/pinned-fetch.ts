import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

/**
 * A fetch that connects to an address somebody else already validated.
 *
 * `checkUrl` resolves a hostname and refuses it if any answer is private, then
 * returns the address it accepted. Until this existed, that address was thrown
 * away and the fetch was issued against the hostname - so the HTTP client
 * resolved it a second time, and nothing tied the second answer to the first.
 * A name under an attacker's control could answer publicly for the check and
 * with 127.0.0.1, a container address or 169.254.169.254 for the connection.
 * The guard was a speed bump on a timer, not a boundary.
 *
 * Pinning closes that window: the socket goes to the address that passed the
 * check, and only that address. Everything the hostname is legitimately needed
 * for - the `Host` header, TLS SNI, certificate verification - still comes from
 * the URL, because only DNS resolution is replaced.
 *
 * The caller re-checks and re-pins on every redirect hop, so a redirect chain
 * cannot walk out of the guard either.
 */

/**
 * Resolution that ignores the hostname and answers with the pinned address.
 *
 * Both shapes of Node's `dns.lookup` contract are honoured. `net.connect` asks
 * for `{ all: true }` and expects an array whenever happy-eyeballs is on, which
 * it is by default from Node 20, and answering that call with the single-address
 * form makes the connection fail rather than fall back.
 */
function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options !== null && options.all === true) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

/**
 * A dispatcher whose connections all go to `address`.
 *
 * One per request rather than one shared pool: an Agent keeps sockets alive for
 * reuse, and reusing a socket across requests would hand a later destination a
 * connection opened for an earlier, separately validated one.
 *
 * Because the pool is never reused, keep-alive has nothing to offer and the
 * timeouts are set as low as undici allows. The socket then closes as soon as
 * the response body is done rather than idling until a default timeout, which
 * is what stops one agent per request from being a socket leak.
 */
export const pinnedAgent = (address: string) =>
  new Agent({ connect: { lookup: pinnedLookup(address) }, keepAliveTimeout: 1, keepAliveMaxTimeout: 1 });

/**
 * Fetches `url` over a connection pinned to `address`.
 *
 * The response body is still streaming when this returns, so the agent is not
 * closed here - that would cut the body off. It is closed on the failure path,
 * where there is no body to protect, and otherwise expires with its socket.
 */
export async function pinnedFetch(url: URL, address: string, init: UndiciRequestInit = {}) {
  const agent = pinnedAgent(address);
  try {
    return await undiciFetch(url, { ...init, dispatcher: agent });
  } catch (error) {
    await agent.close().catch(() => undefined);
    throw error;
  }
}
