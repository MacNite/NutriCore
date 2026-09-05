import { prisma } from "@/lib/db";
import { registrationMode } from "@/lib/env";
import { DEFAULT_LOCALE } from "@/i18n/locales";

/**
 * Who is allowed to create an account, decided in one place.
 *
 * This used to live inline in `registerAction` as `(await user.count()) === 0`,
 * which was two things at once and got both wrong. It was the administrator
 * rule - and a count followed by a separate create is not atomic, so two
 * simultaneous first registrations could both read zero and both create an
 * administrator. And it was *only* the administrator rule: nothing anywhere
 * refused the second registration, so an instance reachable from a network
 * stayed open to anyone who knew the URL, however firmly the README said
 * later accounts "should normally be invited".
 *
 * Both are now the same decision, taken under a lock, on the server, in the
 * server action rather than in the page.
 */

/**
 * Advisory-lock key for the bootstrap decision.
 *
 * PostgreSQL advisory locks share one namespace per database, so the value only
 * has to be unused elsewhere in this application. A transaction-scoped lock is
 * used deliberately: it is released when the transaction ends, including when
 * it ends by rolling back, so a failed registration can never leave the next
 * one waiting for ever.
 */
const BOOTSTRAP_LOCK_KEY = 4711001n;

export class RegistrationClosedError extends Error {
  constructor() {
    super("Registration is closed on this instance");
    this.name = "RegistrationClosedError";
  }
}

export interface NewAccount {
  email: string;
  username: string;
  passwordHash: string;
  displayName: string;
}

/**
 * Creates a self-registered account, or refuses to.
 *
 * The count and the create happen in one transaction behind
 * `pg_advisory_xact_lock`, so concurrent callers are serialised: the second one
 * blocks until the first has committed and then sees the account it created.
 * That is what makes "is this the first account?" a safe question to answer.
 *
 * Throws `RegistrationClosedError` when the policy refuses, and Prisma's own
 * P2002 when the email or username is taken - the caller tells those apart.
 */
export async function createSelfRegisteredUser(account: NewAccount) {
  const mode = registrationMode();
  if (mode === "disabled") throw new RegistrationClosedError();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;

    const existing = await tx.user.count();
    if (existing > 0 && mode !== "open") throw new RegistrationClosedError();

    return tx.user.create({
      data: {
        email: account.email,
        username: account.username,
        passwordHash: account.passwordHash,
        // The first account administers the instance. Inside the lock this is
        // now a fact about the database rather than a guess about it.
        role: existing === 0 ? "ADMIN" : "USER",
        profile: { create: { displayName: account.displayName, language: DEFAULT_LOCALE } },
      },
      select: { id: true },
    });
  });
}

/**
 * Whether the sign-up page should offer the form at all.
 *
 * Advisory only. It races with another registration by design - answering it
 * needs no lock because being wrong costs a rejected form submission, not an
 * unauthorised account. `createSelfRegisteredUser` is the boundary.
 */
export async function registrationAvailable(): Promise<boolean> {
  const mode = registrationMode();
  if (mode === "disabled") return false;
  if (mode === "open") return true;
  return (await prisma.user.count()) === 0;
}
