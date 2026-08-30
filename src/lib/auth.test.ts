import { describe, expect, it } from "vitest";
import { createSessionToken, hashPassword, hashSessionToken, passwordProblem, verifyPassword } from "./auth";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong password entirely")).toBe(false);
  }, 20_000);

  it("never stores the password itself", async () => {
    const hash = await hashPassword("a-very-secret-value");
    expect(hash).not.toContain("a-very-secret-value");
  }, 20_000);

  it("returns false instead of throwing on a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });
});

describe("session tokens", () => {
  it("issues unique tokens and persists only the hash", () => {
    const a = createSessionToken();
    const b = createSessionToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(a.token);
    expect(a.tokenHash).toBe(hashSessionToken(a.token));
    expect(a.tokenHash).toHaveLength(64);
  });
});

describe("password policy", () => {
  it("requires length and rejects obvious passwords", () => {
    expect(passwordProblem("short")).toBe("too-short");
    expect(passwordProblem("password1234")).toBe("too-common");
    expect(passwordProblem("grüner-tee-am-morgen")).toBeNull();
  });
});
