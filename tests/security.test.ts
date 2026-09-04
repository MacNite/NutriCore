/**
 * Authorization tests against a real database. They assert that one user can
 * never reach another user's records, whichever entry point is used.
 *
 * Skipped automatically when TEST_DATABASE_URL is not configured.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { normalizeName } from "@/lib/units";
import { saveRecipe } from "@/server/recipes";
import { getPublication, listPublications, publishRecipe, savePublicationAsRecipe, withdrawPublication } from "@/server/recipe-publications";

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

  it("keeps a recipe diary snapshot when the recipe is deleted", async () => {
    const recipe = await prisma.recipe.create({ data: { ownerId: alice, name: "Snapshot recipe", servings: 2 } });
    const day = await prisma.diaryDay.findFirstOrThrow({ where: { userId: alice } });
    const snapshot = { nutrients: { energyKcal: 250, protein: null }, basisAmount: 1, basisUnit: "SERVING", amount: 1 };
    const entry = await prisma.diaryEntry.create({ data: { diaryDayId: day.id, recipeId: recipe.id, meal: "DINNER", label: recipe.name, quantity: 1, unit: "serving", nutritionSnapshot: snapshot, provenanceSnapshot: { sourceType: "RECIPE", externalId: recipe.id } } });

    await prisma.recipe.delete({ where: { id: recipe.id } });
    const preserved = await prisma.diaryEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(preserved.recipeId).toBeNull();
    expect(preserved.nutritionSnapshot).toEqual(snapshot);
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

    // A recipe built out of a food the same user created. This is the ordinary
    // case - custom food, then recipe - and it used to make the account
    // undeletable: `RecipeIngredient.foodId` restricted deletes, so the cascade
    // hit its own foreign key and `deleteAccountAction` failed outright.
    const ownFood = await prisma.food.create({
      data: {
        ownerId: doomed.id, name: `Doomed food ${stamp}`, normalizedName: normalizeName(`Doomed food ${stamp}`),
        foodType: "GENERIC", sourceType: "USER", basisAmount: 100, basisUnit: "G",
      },
    });
    const ownRecipe = await prisma.recipe.create({
      data: {
        ownerId: doomed.id, name: `Doomed recipe ${stamp}`, servings: 2,
        ingredients: { create: [{ foodId: ownFood.id, amount: 100, unit: "g", position: 0 }] },
      },
    });

    await prisma.user.delete({ where: { id: doomed.id } });

    expect(await prisma.userProfile.findUnique({ where: { userId: doomed.id } })).toBeNull();
    expect(await prisma.weightEntry.findMany({ where: { userId: doomed.id } })).toHaveLength(0);
    expect(await prisma.session.findMany({ where: { userId: doomed.id } })).toHaveLength(0);
    expect(await prisma.food.findUnique({ where: { id: ownFood.id } })).toBeNull();
    expect(await prisma.recipe.findUnique({ where: { id: ownRecipe.id } })).toBeNull();
    expect(await prisma.recipeIngredient.findMany({ where: { recipeId: ownRecipe.id } })).toHaveLength(0);
  });
});

/**
 * Recipe sharing, against a real database.
 *
 * The unit tests assert which query the service runs; these assert what the
 * database ends up holding - that a recipe crossing the boundary between two
 * members leaves the author's rows on the author's side of it.
 */
describeDb("shared recipes", () => {
  let alice: string;
  let bob: string;
  let alicePrivateFood: string;
  let sharedFood: string;
  let aliceRecipe: string;
  let publicationId: string;

  beforeAll(async () => {
    const stamp = `${Date.now().toString(36)}-share`;

    const a = await prisma.user.create({
      data: { email: `share-alice-${stamp}@test.local`, username: `sharealice${stamp}`, passwordHash: "x", profile: { create: { displayName: "Alice" } } },
    });
    const b = await prisma.user.create({
      data: { email: `share-bob-${stamp}@test.local`, username: `sharebob${stamp}`, passwordHash: "x", profile: { create: { displayName: "Bob" } } },
    });
    alice = a.id;
    bob = b.id;

    // One food only Alice can see, and one every member can.
    const secret = await prisma.food.create({
      data: {
        ownerId: alice, name: `Omas Sauce ${stamp}`, normalizedName: normalizeName(`Omas Sauce ${stamp}`),
        foodType: "GENERIC", sourceType: "USER", basisAmount: 100, basisUnit: "G",
        nutrients: { create: [{ nutrientKey: "energyKcal", value: 120 }] },
      },
    });
    alicePrivateFood = secret.id;

    const shared = await prisma.food.create({
      data: {
        ownerId: null, name: `Passata ${stamp}`, normalizedName: normalizeName(`Passata ${stamp}`),
        foodType: "PACKAGED", sourceType: "OPEN_FOOD_FACTS", externalProvider: "openfoodfacts",
        externalId: `share-${stamp}`, basisAmount: 100, basisUnit: "G",
        nutrients: { create: [{ nutrientKey: "energyKcal", value: 32 }] },
      },
    });
    sharedFood = shared.id;

    const saved = await saveRecipe(alice, {
      name: `Sugo ${stamp}`, description: "Private note", servings: 4, instructions: "Cook.", tags: ["pasta"],
      ingredients: [
        { foodId: alicePrivateFood, amount: 200, unit: "g" },
        { foodId: sharedFood, amount: 400, unit: "g" },
      ],
    });
    aliceRecipe = saved.recipe.id;

    const publication = await publishRecipe(alice, aliceRecipe, {
      title: `Sugo ${stamp}`, description: "For four", instructions: "Cook.", tags: ["pasta"],
    });
    publicationId = publication.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
    await prisma.food.deleteMany({ where: { id: sharedFood } });
  });

  it("publishes no reference to the author's food rows", async () => {
    const ingredients = await prisma.recipePublicationIngredient.findMany({ where: { publicationId } });
    expect(ingredients).toHaveLength(2);
    expect(JSON.stringify(ingredients)).not.toContain(alicePrivateFood);
  });

  it("gives a saving member their own recipe, their own foods and nothing of the author's", async () => {
    const { recipe, unsaved } = await savePublicationAsRecipe(bob, publicationId);
    expect(unsaved).toEqual([]);
    expect(recipe.ownerId).toBe(bob);

    const ingredients = await prisma.recipeIngredient.findMany({ where: { recipeId: recipe.id }, include: { food: true } });
    expect(ingredients).toHaveLength(2);
    for (const ingredient of ingredients) {
      // Every food the copy points at is one Bob may read: a shared row, or a
      // private row of his own. Never Alice's.
      expect(ingredient.food.ownerId === null || ingredient.food.ownerId === bob).toBe(true);
      expect(ingredient.foodId).not.toBe(alicePrivateFood);
    }
    // The ownerless provider row is re-used rather than duplicated.
    expect(ingredients.some((item) => item.foodId === sharedFood)).toBe(true);
    // The author's private food became a copy Bob owns.
    const copied = ingredients.find((item) => item.food.ownerId === bob && item.food.sourceType === "IMPORTED");
    expect(copied?.food.name).toContain("Omas Sauce");
    expect(await prisma.food.findFirst({ where: { id: alicePrivateFood, ownerId: bob } })).toBeNull();
  });

  it("credits the author on the copy", async () => {
    const copy = await prisma.recipe.findFirstOrThrow({ where: { ownerId: bob, forkedFromPublicationId: publicationId } });
    expect(copy.forkedFromAuthorSnapshot).toBe("Alice");
  });

  it("keeps a saved copy working when the author deletes the recipe it came from", async () => {
    const copy = await prisma.recipe.findFirstOrThrow({ where: { ownerId: bob, forkedFromPublicationId: publicationId } });
    const before = await prisma.recipeIngredient.findMany({ where: { recipeId: copy.id } });

    await prisma.recipe.delete({ where: { id: aliceRecipe } });

    const after = await prisma.recipeIngredient.findMany({ where: { recipeId: copy.id } });
    expect(after).toHaveLength(before.length);
    // The publication outlives the private recipe rather than cascading with it.
    const publication = await prisma.recipePublication.findUniqueOrThrow({ where: { id: publicationId } });
    expect(publication.sourceRecipeId).toBeNull();
  });

  it("hides a withdrawn publication from every member but its author", async () => {
    await withdrawPublication(alice, publicationId);

    const feed = await listPublications();
    expect(feed.items.map((item) => item.id)).not.toContain(publicationId);
    // Not merely unlisted: unreachable by its address too.
    expect(await getPublication(bob, publicationId)).toBeNull();
    expect((await getPublication(alice, publicationId))?.publication.id).toBe(publicationId);
  });

  it("does not let a member withdraw somebody else's publication", async () => {
    await expect(withdrawPublication(bob, publicationId)).rejects.toThrow();
  });
});
