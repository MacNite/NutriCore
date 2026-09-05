import { describe, expect, it } from "vitest";
import { redactOptional, redactSecrets } from "./redact";

/**
 * The strings these run on are error messages that get written to the database
 * and rendered on the admin page, and which nothing expires. The examples below
 * are the shapes real clients produce.
 */
describe("redactSecrets", () => {
  it("removes an API key from a query string", () => {
    const text = "Error: GET https://api.nal.usda.gov/fdc/v1/search?query=apple&api_key=abc123SECRET failed with 403";
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("abc123SECRET");
    expect(redacted).toContain("[redacted]");
    // The parts that make the message useful survive.
    expect(redacted).toContain("api.nal.usda.gov");
    expect(redacted).toContain("403");
  });

  it("removes credentials embedded in a URL", () => {
    const redacted = redactSecrets("connect failed for postgresql://nutricore:hunter2@db:5432/nutricore");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("db:5432/nutricore");
  });

  it("removes a bearer token", () => {
    const redacted = redactSecrets("401 Unauthorized (Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def)");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redacted).toContain("401 Unauthorized");
  });

  it("handles the several spellings a provider might use", () => {
    for (const text of [
      "client_secret=topsecret",
      "access-token: topsecret",
      'password="topsecret"',
      "X-Api-Key: topsecret",
    ]) {
      expect(redactSecrets(text)).not.toContain("topsecret");
    }
  });

  it("leaves an ordinary diagnostic untouched", () => {
    // Over-redaction costs the administrator the message they needed.
    const text = "TypeError: fetch failed → Error: connect ECONNREFUSED 10.8.0.4:11434 (ECONNREFUSED)";
    expect(redactSecrets(text)).toBe(text);
  });

  it("caps the length, because these columns are unbounded", () => {
    expect(redactSecrets("x".repeat(5000)).length).toBe(800);
    expect(redactSecrets("x".repeat(5000), 100).length).toBe(100);
  });

  it("passes an absent value through", () => {
    expect(redactOptional(undefined)).toBeUndefined();
    expect(redactOptional(null)).toBeUndefined();
  });
});
