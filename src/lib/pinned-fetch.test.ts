import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinnedFetch } from "./pinned-fetch";

/**
 * These run against a real loopback HTTP server, because the property under
 * test is a property of the socket: that the connection went to the address it
 * was pinned to and not to whatever the hostname resolves to.
 *
 * A mocked fetch could not show that. The bug being fixed was invisible at the
 * fetch API - the URL passed in was always the checked one - and lived entirely
 * in what the transport did with it afterwards.
 */

let server: Server;
let port: number;
const seen: { host?: string; url?: string }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({ host: request.headers.host, url: request.url });
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("reached");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("pinned fetch", () => {
  it("connects to the pinned address, not to whatever the hostname resolves to", async () => {
    seen.length = 0;
    /* `.invalid` is reserved by RFC 2606 and resolves nowhere, so this request
       can only succeed by ignoring resolution entirely and using the pin. If
       pinning regressed to an ordinary fetch, this would fail to resolve. */
    const url = new URL(`http://pinned.invalid:${port}/page`);

    const response = await pinnedFetch(url, "127.0.0.1");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("reached");
    expect(seen).toHaveLength(1);
  });

  it("still sends the original hostname as the Host header", async () => {
    seen.length = 0;
    // The hostname is what the certificate and any virtual host are keyed on,
    // so replacing resolution must not also replace the name on the request.
    await (await pinnedFetch(new URL(`http://pinned.invalid:${port}/page`), "127.0.0.1")).text();

    expect(seen[0].host).toBe(`pinned.invalid:${port}`);
    expect(seen[0].url).toBe("/page");
  });

  it("fails rather than falling back when the pinned address refuses", async () => {
    // Pinned at an address with nothing listening: a fetch that quietly fell
    // back to resolving the hostname would be the whole vulnerability back.
    const url = new URL(`http://localhost:${port}/page`);
    await expect(pinnedFetch(url, "127.0.0.2")).rejects.toThrow();
  });
});
