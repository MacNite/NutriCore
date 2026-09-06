import { describe, expect, it } from "vitest";
import { bearerToken, createHealthToken, hashHealthToken, HEALTH_TOKEN_PREFIX, looksLikeHealthToken } from "@/lib/health-token";

describe("health sync tokens", () => {
  it("issues a prefixed token whose hash is not the token", () => {
    const { token, tokenHash } = createHealthToken();
    expect(token.startsWith(HEALTH_TOKEN_PREFIX)).toBe(true);
    expect(looksLikeHealthToken(token)).toBe(true);
    expect(tokenHash).toBe(hashHealthToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it("does not issue the same token twice", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createHealthToken().token));
    expect(tokens.size).toBe(200);
  });

  it("rejects anything that is not token-shaped", () => {
    expect(looksLikeHealthToken("")).toBe(false);
    expect(looksLikeHealthToken("nutricore")).toBe(false);
    // Right length, wrong prefix.
    expect(looksLikeHealthToken("x".repeat(47))).toBe(false);
    // Right prefix, too short - a truncated paste.
    expect(looksLikeHealthToken(`${HEALTH_TOKEN_PREFIX}abc`)).toBe(false);
    // Right prefix and length, but base64 rather than base64url.
    expect(looksLikeHealthToken(`${HEALTH_TOKEN_PREFIX}${"a".repeat(41)}+/`)).toBe(false);
  });
});

describe("bearer header", () => {
  const { token } = createHealthToken();

  it("reads a well-formed header", () => {
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`  Bearer   ${token}  `)).toBe(token);
  });

  it("refuses everything else", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(token)).toBeNull();
    expect(bearerToken(`Basic ${token}`)).toBeNull();
    // A scheme that merely starts with the right letters is not the right scheme.
    expect(bearerToken(`Bearerish ${token}`)).toBeNull();
    // Two values where one is expected: taking the first would be a guess.
    expect(bearerToken(`Bearer ${token} ${token}`)).toBeNull();
    expect(bearerToken("Bearer not-a-token")).toBeNull();
  });
});
