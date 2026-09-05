import { beforeEach, describe, expect, it, vi } from "vitest";

const { count, create, executeRaw, transaction } = vi.hoisted(() => {
  const count = vi.fn(async () => 0);
  const create = vi.fn(async () => ({ id: "user-1" }));
  const executeRaw = vi.fn(async () => 1);
  /* The interactive-transaction callback, run against the same mocks. The real
     client hands the callback a scoped client; nothing here depends on it being
     a different object from `prisma`. */
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn({ $executeRaw: executeRaw, user: { count, create } }),
  );
  return { count, create, executeRaw, transaction };
});

vi.mock("@/lib/db", () => ({
  prisma: { $transaction: transaction, user: { count, create } },
}));

import { RegistrationClosedError, createSelfRegisteredUser, registrationAvailable } from "./registration";

const account = { email: "a@test.local", username: "alice", passwordHash: "hash", displayName: "Alice" };

beforeEach(() => {
  count.mockClear().mockResolvedValue(0);
  create.mockClear().mockResolvedValue({ id: "user-1" });
  executeRaw.mockClear();
  transaction.mockClear();
  delete process.env.REGISTRATION_MODE;
});

/**
 * The bootstrap rule is the whole of the registration policy, so these assert
 * both halves of it: who gets in, and who gets to be the administrator.
 */
describe("createSelfRegisteredUser", () => {
  it("makes the very first account an administrator", async () => {
    await createSelfRegisteredUser(account);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "ADMIN" }) }));
  });

  it("takes the advisory lock before counting, inside the transaction", async () => {
    await createSelfRegisteredUser(account);
    expect(transaction).toHaveBeenCalledOnce();
    expect(executeRaw).toHaveBeenCalledOnce();
    // Ordering is the entire point: counting first would race exactly as before.
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(count.mock.invocationCallOrder[0]);
  });

  it("refuses a second account in the default bootstrap mode", async () => {
    count.mockResolvedValue(1);
    await expect(createSelfRegisteredUser(account)).rejects.toBeInstanceOf(RegistrationClosedError);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses even the first account when registration is disabled", async () => {
    process.env.REGISTRATION_MODE = "disabled";
    await expect(createSelfRegisteredUser(account)).rejects.toBeInstanceOf(RegistrationClosedError);
    // Refused before the transaction, so a closed instance does no database work.
    expect(transaction).not.toHaveBeenCalled();
  });

  it("allows later accounts in open mode, without making them administrators", async () => {
    process.env.REGISTRATION_MODE = "open";
    count.mockResolvedValue(3);
    await createSelfRegisteredUser(account);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "USER" }) }));
  });

  it("treats an unrecognised mode as bootstrap rather than as open", async () => {
    process.env.REGISTRATION_MODE = "everyone-welcome";
    count.mockResolvedValue(1);
    await expect(createSelfRegisteredUser(account)).rejects.toBeInstanceOf(RegistrationClosedError);
  });
});

describe("registrationAvailable", () => {
  it("offers the form only while the instance has no account", async () => {
    expect(await registrationAvailable()).toBe(true);
    count.mockResolvedValue(1);
    expect(await registrationAvailable()).toBe(false);
  });

  it("never offers the form when registration is disabled", async () => {
    process.env.REGISTRATION_MODE = "disabled";
    expect(await registrationAvailable()).toBe(false);
  });

  it("always offers the form in open mode, without asking the database", async () => {
    process.env.REGISTRATION_MODE = "open";
    count.mockResolvedValue(9);
    expect(await registrationAvailable()).toBe(true);
    expect(count).not.toHaveBeenCalled();
  });
});
