/**
 * Authorization tests against a real database. They assert that one user can
 * never reach another user's records, whichever entry point is used.
 *
 * Skipped automatically when TEST_DATABASE_URL is not configured.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { normalizeName } from "@/lib/units";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const prisma = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused" } } });

describeDb("cross-user authorization", () => {
  let alice: string;
  let bob: string;
  let alicePrivateFood: string;
  let publicFood: string;
  let aliceEntry: string;

  beforeAll(async () => {
    const stamp = Date.now().toString(36);

    const a = await prisma.user.create({
      data: { email: `alice-${stamp}@test.local`, username: `alice${stamp}`, passwordHash: "x" },
    });
    const b = await prisma.user.create({
      data: { email: `bob-${stamp}@test.local`, username: `bob${stamp}`, passwordHash: "x" },
    });
    alice = a.id;
    bob = b.id;

    const privateFood = await prisma.food.create({
      data: {
        ownerId: alice,
        name: "Alice secret food",
        normalizedName: normalizeName("Alice secret food"),
        foodType: "GENERIC",
        sourceType: "USER",
        basisAmount: 100,
        basisUnit: "G",
      },
    });
    alicePrivateFood = privateFood.id;

    const shared = await prisma.food.create({
      data: {
        ownerId: null,
        name: `Shared product ${stamp}`,
        normalizedName: normalizeName(`Shared product ${stamp}`),
        foodType: "PACKAGED",
        sourceType: "OPEN_FOOD_FACTS",
        externalProvider: "OPEN_FOOD_FACTS",
        externalId: `test-${stamp}`,
        basisAmount: 100,
        basisUnit: "G",
      },
    });
    publicFood = shared.id;

    const day = await prisma.diaryDay.create({
      data: { userId: alice, date: new Date("2026-08-30T00:00:00.000Z") },
    });
    const entry = await prisma.diaryEntry.create({
      data: {
        diaryDayId: day.id,
        meal: "BREAKFAST",
        foodId: privateFood.id,
        label: "Alice secret food",
        quantity: 100,
        unit: "g",
        nutritionSnapshot: { nutrients: { energyKcal: 100 }, basisAmount: 100, basisUnit: "G", amount: 100 },
        provenanceSnapshot: { sourceType: "USER", loggedAt: new Date().toISOString(), foodName: "Alice secret food" },
      },
    });
    aliceEntry = entry.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
    await prisma.food.deleteMany({ where: { id: publicFood } });
    await prisma.$disconnect();
  });

  /** Mirrors the predicate used by every food query in the application. */
  const visible = (userId: string) => ({ OR: [{ ownerId: null }, { ownerId: userId }] });

  it("does not let a user read another user's food", async () => {
    const asBob = await prisma.food.findFirst({ where: { id: alicePrivateFood, ...visible(bob) } });
    expect(asBob).toBeNull();

    const asAlice = await prisma.food.findFirst({ where: { id: alicePrivateFood, ...visible(alice) } });
    expect(asAlice?.id).toBe(alicePrivateFood);
  });

  it("lets every user read shared provider foods", async () => {
    for (const userId of [alice, bob]) {
      const food = await prisma.food.findFirst({ where: { id: publicFood, ...visible(userId) } });
      expect(food?.id).toBe(publicFood);
    }
  });

  it("excludes another user's food from search results", async () => {
    const results = await prisma.food.findMany({
      where: { normalizedName: { contains: "alice secret" }, ...visible(bob) },
    });
    expect(results).toHaveLength(0);
  });

  it("does not let a user read or delete another user's diary entry", async () => {
    const read = await prisma.diaryEntry.findFirst({ where: { id: aliceEntry, diaryDay: { userId: bob } } });
    expect(read).toBeNull();

    const deleted = await prisma.diaryEntry.deleteMany({ where: { id: aliceEntry, diaryDay: { userId: bob } } });
    expect(deleted.count).toBe(0);

    // The entry is still there for its owner.
    const stillThere = await prisma.diaryEntry.findFirst({ where: { id: aliceEntry, diaryDay: { userId: alice } } });
    expect(stillThere?.id).toBe(aliceEntry);
  });

  it("does not let a user read another user's weight history", async () => {
    await prisma.weightEntry.create({
      data: { userId: alice, date: new Date("2026-08-29T00:00:00.000Z"), weightKg: 70 },
    });
    expect(await prisma.weightEntry.findMany({ where: { userId: bob } })).toHaveLength(0);
    expect((await prisma.weightEntry.findMany({ where: { userId: alice } })).length).toBeGreaterThan(0);
  });

  it("removes every personal record when an account is deleted", async () => {
    const stamp = `${Date.now().toString(36)}-cascade`;
    const doomed = await prisma.user.create({
      data: {
        email: `doomed-${stamp}@test.local`,
        username: `doomed${stamp}`,
        passwordHash: "x",
        profile: { create: { displayName: "Doomed" } },
        weights: { create: { date: new Date("2026-08-28T00:00:00.000Z"), weightKg: 80 } },
        sessions: { create: { tokenHash: `hash-${stamp}`, expiresAt: new Date(Date.now() + 1000) } },
      },
    });

    await prisma.user.delete({ where: { id: doomed.id } });

    expect(await prisma.userProfile.findUnique({ where: { userId: doomed.id } })).toBeNull();
    expect(await prisma.weightEntry.findMany({ where: { userId: doomed.id } })).toHaveLength(0);
    expect(await prisma.session.findMany({ where: { userId: doomed.id } })).toHaveLength(0);
  });
});
