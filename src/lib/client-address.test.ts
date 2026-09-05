import { describe, expect, it } from "vitest";
import { clientAddress } from "@/lib/client-address";

/**
 * The rate-limit key. If a caller can choose it, every limit keyed on it is
 * decorative - which is what taking the leftmost `X-Forwarded-For` entry meant
 * in practice, since that entry is the one a client writes for itself.
 */
const headers = (forwarded?: string) => ({
  get: (name: string) => (name === "x-forwarded-for" && forwarded !== undefined ? forwarded : null),
});

describe("client address", () => {
  it("ignores the header entirely when no proxy is configured", () => {
    // The stock deployment publishes its own port, so anything in this header
    // was written by the caller.
    expect(clientAddress(headers("1.2.3.4"), 0)).toBe("direct");
    expect(clientAddress(headers("9.9.9.9, 1.2.3.4"), 0)).toBe("direct");
  });

  it("takes the entry the trusted proxy appended, not the one the client sent", () => {
    // The client claimed 9.9.9.9; the single trusted proxy appended 1.2.3.4.
    expect(clientAddress(headers("9.9.9.9, 1.2.3.4"), 1)).toBe("1.2.3.4");
  });

  it("counts hops from the right, so prepended entries cannot shift the result", () => {
    const real = "203.0.113.7, 198.51.100.2";
    expect(clientAddress(headers(real), 2)).toBe("203.0.113.7");
    // The same request with four forged entries prepended still resolves to the
    // same address: forgery only ever grows the left-hand side.
    expect(clientAddress(headers(`1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4, ${real}`), 2)).toBe("203.0.113.7");
  });

  it("refuses to guess when the chain is shorter than the configured hops", () => {
    // Falling back to the leftmost entry here would reintroduce the bug for any
    // request that simply omits the header.
    expect(clientAddress(headers("1.2.3.4"), 2)).toBe("unverified");
    expect(clientAddress(headers(), 1)).toBe("unverified");
    expect(clientAddress(headers(""), 1)).toBe("unverified");
  });

  it("does not let padding or empty entries shift the count", () => {
    expect(clientAddress(headers("  9.9.9.9 ,, 1.2.3.4  "), 1)).toBe("1.2.3.4");
  });
});
