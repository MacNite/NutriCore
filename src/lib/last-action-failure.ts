/**
 * What the last failed Server Action request got back, for the error screen.
 *
 * React reports a proxy's answer only as "An unexpected response was received
 * from the server", which says nothing about *who* answered. The status and the
 * `Server` header do: a Cloudflare block, a proxy's 413 and the app itself each
 * sign their responses differently, and none of the first two leaves a line in
 * the application's log to find it by.
 *
 * Installed once, in the browser, by importing this module. Only requests that
 * carry the `Next-Action` header are looked at, and only their status and two
 * headers are kept - never a body.
 */
let lastFailure: string | null = null;

export const lastActionFailure = () => lastFailure;

const isActionRequest = (init?: RequestInit) => {
  const headers = init?.headers;
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has("next-action");
  if (Array.isArray(headers)) return headers.some(([name]) => name.toLowerCase() === "next-action");
  return Object.keys(headers).some((name) => name.toLowerCase() === "next-action");
};

if (typeof window !== "undefined" && !(window.fetch as { nutricoreWrapped?: boolean }).nutricoreWrapped) {
  const original = window.fetch.bind(window);
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isActionRequest(init)) return original(input, init);
    try {
      const response = await original(input, init);
      const type = response.headers.get("content-type") ?? "";
      // The app always answers an action as a React stream; anything else is
      // what React then calls "an unexpected response".
      if (!type.includes("text/x-component")) {
        const server = response.headers.get("server");
        const ray = response.headers.get("cf-ray");
        lastFailure = [`HTTP ${response.status}`, server && `server ${server}`, ray && `cf-ray ${ray}`].filter(Boolean).join(", ");
      } else {
        lastFailure = null;
      }
      return response;
    } catch (error) {
      lastFailure = `request not sent (${error instanceof Error ? error.message : String(error)})`;
      throw error;
    }
  };
  (wrapped as { nutricoreWrapped?: boolean }).nutricoreWrapped = true;
  window.fetch = wrapped as typeof window.fetch;
}
