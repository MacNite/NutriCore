import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { findUnique, update, requireUser, verifyPassword, sendEmailChangedMail, durableLimit } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  requireUser: vi.fn(async () => ({ id: "user-1", displayName: "Ada" })),
  verifyPassword: vi.fn(async (_hash: string, password: string) => password === "correct horse"),
  sendEmailChangedMail: vi.fn(async () => ({ sent: true as const })),
  durableLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique, update } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./session", () => ({ requireUser }));
vi.mock("./targets", () => ({ recalculateTarget: vi.fn() }));
vi.mock("./durable-rate-limit", () => ({ durableRateLimitOrFallback: durableLimit }));
vi.mock("@/lib/mail", () => ({ sendEmailChangedMail }));
vi.mock("@/lib/auth", () => ({ PASSWORD_CHANGE_COOKIE: "pc", SESSION_COOKIE: "s", verifyPassword }));

import { changeEmailAction } from "./profile-actions";
import { SSO_ONLY_PASSWORD_HASH } from "@/lib/oidc";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ email: "old@example.com", passwordHash: "$argon2id$hash" });
  update.mockReset().mockResolvedValue({});
  verifyPassword.mockClear();
  sendEmailChangedMail.mockReset().mockResolvedValue({ sent: true });
  durableLimit.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("changeEmailAction", () => {
  it("stores the new address, normalised, and notifies the old one", async () => {
    const result = await changeEmailAction({}, form({ email: "  New@Example.com ", password: "correct horse" }));
    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { email: "new@example.com" } });
    expect(sendEmailChangedMail).toHaveBeenCalledWith(expect.objectContaining({ to: "old@example.com" }));
  });

  it("refuses a wrong password and changes nothing", async () => {
    const result = await changeEmailAction({}, form({ email: "new@example.com", password: "wrong" }));
    expect(result).toEqual({ error: "wrongPassword" });
    expect(update).not.toHaveBeenCalled();
    expect(sendEmailChangedMail).not.toHaveBeenCalled();
  });

  it("refuses single-sign-on accounts, whose address belongs to the provider", async () => {
    findUnique.mockResolvedValue({ email: "old@example.com", passwordHash: SSO_ONLY_PASSWORD_HASH });
    const result = await changeEmailAction({}, form({ email: "new@example.com", password: "anything" }));
    expect(result).toEqual({ error: "ssoManaged" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports an address another account already uses", async () => {
    update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }));
    const result = await changeEmailAction({}, form({ email: "taken@example.com", password: "correct horse" }));
    expect(result).toEqual({ error: "emailTaken" });
    expect(sendEmailChangedMail).not.toHaveBeenCalled();
  });

  it("rejects an invalid or unchanged address", async () => {
    expect(await changeEmailAction({}, form({ email: "not-an-email", password: "correct horse" }))).toEqual({ error: "validation" });
    expect(await changeEmailAction({}, form({ email: "OLD@example.com", password: "correct horse" }))).toEqual({ error: "sameEmail" });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the change when the notice cannot be delivered", async () => {
    sendEmailChangedMail.mockRejectedValue(new Error("SMTP down"));
    const result = await changeEmailAction({}, form({ email: "new@example.com", password: "correct horse" }));
    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalled();
  });

  it("stops checking passwords once the account's budget is spent", async () => {
    durableLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const result = await changeEmailAction({}, form({ email: "new@example.com", password: "correct horse" }));
    expect(result).toEqual({ error: "rateLimited" });
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});
