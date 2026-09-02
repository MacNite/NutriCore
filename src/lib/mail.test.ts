import { afterEach, describe, expect, it } from "vitest";
import { decryptMailPassword, encryptMailPassword } from "./mail";

const originalSecret = process.env.APP_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = originalSecret;
});

describe("SMTP credential encryption", () => {
  it("round-trips a password without storing it as plaintext", () => {
    process.env.APP_SECRET = "a sufficiently long application secret for testing";
    const encrypted = encryptMailPassword("smtp-secret");

    expect(encrypted).not.toContain("smtp-secret");
    expect(decryptMailPassword(encrypted)).toBe("smtp-secret");
  });

  it("cannot decrypt a credential after APP_SECRET changes", () => {
    process.env.APP_SECRET = "first sufficiently long application secret";
    const encrypted = encryptMailPassword("smtp-secret");
    process.env.APP_SECRET = "second sufficiently long application secret";

    expect(() => decryptMailPassword(encrypted)).toThrow();
  });
});
