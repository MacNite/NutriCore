import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { completeOnboarding, openQuickActions, registerAndOnboard } from "./helpers";

const prisma = new PrismaClient();
test.afterAll(async () => prisma.$disconnect());

// Its own file rather than diary.spec.ts: these accounts have to be known by
// name to set up a run for them, and that file's beforeEach signs a user in
// already - registering a second one from inside a test only redirects away
// from /register.

/** The signed-in account, by the name the test registered it under. */
const accountOf = async (username: string) =>
  prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } });

/**
 * A draft recipe as the worker would leave one: listed, not yet confirmed, and
 * with a food behind its single ingredient so the page can weigh it.
 */
async function draftRecipe(userId: string, name: string, importId?: string) {
  const food = await prisma.food.create({
    data: { ownerId: userId, name: `${name}-Zutat`, normalizedName: `${name.toLowerCase()}-zutat`, locale: "de", sourceType: "USER", basisUnit: "G" },
  });
  return prisma.recipe.create({
    data: {
      ownerId: userId,
      name,
      servings: 2,
      status: "DRAFT",
      sourceType: "AI_RESEARCH",
      importId,
      ingredients: { create: [{ foodId: food.id, amount: 250, unit: "g", normalizedGrams: 250 }] },
    },
  });
}

test("the quick-meal row is gone once the user switches AI off", async ({ page }) => {
  // The quick meal is an AI run and nothing else, but it was the one entry
  // point that never asked whether the user wanted AI at all: with the switch
  // off, the floating button still queued an extraction. The rest of the menu
  // needs no AI, so only that row goes.
  const user = await registerAndOnboard(page);
  await completeOnboarding(page);
  const describeMeal = /describe a meal|mahlzeit beschreiben/i;
  await expect((await openQuickActions(page)).getByRole("button", { name: describeMeal })).toBeVisible();

  const account = await prisma.user.findUniqueOrThrow({ where: { username: user.username }, select: { id: true } });
  await prisma.userProfile.update({ where: { userId: account.id }, data: { aiEnabled: false } });

  await page.goto("/");
  const menu = await openQuickActions(page);
  await expect(menu.getByRole("button", { name: describeMeal })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: /create recipe|rezept erstellen/i })).toBeVisible();
});

test("a finished recipe import opens the recipe it produced", async ({ page }) => {
  // The extraction used to end by quietly filling the form underneath, which
  // reads as an import that went nowhere.
  const user = await registerAndOnboard(page);
  await completeOnboarding(page);
  const account = await accountOf(user.username);

  const record = await prisma.aiIngestionInput.create({ data: { userId: account.id, intent: "RECIPE", text: "Pfannkuchen", servings: 2 } });
  const job = await prisma.aiJob.create({
    data: { userId: account.id, entityType: "AI_INGESTION", entityId: record.id, status: "RUNNING", startedAt: new Date() },
  });

  await page.goto(`/recipes/new?import=${record.id}`);
  await expect(page.getByText(/eingereiht|queued/i)).toBeVisible();

  const recipe = await draftRecipe(account.id, "Pfannkuchen", record.id);
  await prisma.aiIngestionInput.update({
    where: { id: record.id },
    data: { draft: { name: "Pfannkuchen", description: "", servings: 2, instructions: "", ingredients: [], unmatched: [], recipeId: recipe.id } },
  });
  await prisma.aiJob.update({
    where: { id: job.id },
    data: { status: "COMPLETED", completedAt: new Date(), metadata: { outcome: { recipeId: recipe.id } } },
  });

  await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`), { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Pfannkuchen" })).toBeVisible();
});

test("a quick meal that asked only for a recipe opens it instead of staying in the meal review", async ({ page }) => {
  const user = await registerAndOnboard(page);
  await completeOnboarding(page);
  const account = await accountOf(user.username);

  const input = await prisma.aiIngestionInput.create({
    data: { userId: account.id, intent: "RECIPE", text: "Ofengemüse", meal: "DINNER", diaryDate: new Date("2026-09-03T00:00:00.000Z"), servings: 1 },
  });
  const job = await prisma.aiJob.create({
    data: {
      userId: account.id,
      entityType: "AI_INGESTION",
      entityId: input.id,
      ingestionInputId: input.id,
      status: "RUNNING",
      startedAt: new Date(),
      // Asked for a recipe and explicitly not a diary entry.
      metadata: { addToMeal: false, createRecipe: true },
    },
  });

  await page.goto(`/ai-review/${input.id}`);
  await expect(page.getByText(/KI-Anreicherung läuft|running/i)).toBeVisible();

  // The worker completes the job before it keeps the recipe, so the page stops
  // its own polling in between. Split here on purpose: without the redirect's
  // own grace poll the destination would arrive after the last refresh.
  await prisma.aiJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await expect(page.getByText(/Bereit zur Prüfung|ready for review/i)).toBeVisible({ timeout: 20_000 });

  const recipe = await draftRecipe(account.id, "Ofengemüse");
  await prisma.aiJob.update({
    where: { id: job.id },
    data: { metadata: { addToMeal: false, createRecipe: true, outcome: { recipeId: recipe.id, recipeName: recipe.name } } },
  });

  await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`), { timeout: 20_000 });
});

test("opening a finished run later stays on its review, which is the only way back to the proposal", async ({ page }) => {
  // The redirect is for the reader who watched the run finish. If it fired for
  // everyone the proposal behind this page could never be read again - the
  // dashboard card and this URL both lead here.
  const user = await registerAndOnboard(page);
  await completeOnboarding(page);
  const account = await accountOf(user.username);

  const input = await prisma.aiIngestionInput.create({
    data: { userId: account.id, intent: "RECIPE", text: "Ofengemüse", meal: "DINNER", diaryDate: new Date("2026-09-03T00:00:00.000Z"), servings: 1 },
  });
  const recipe = await draftRecipe(account.id, "Ofengemüse spät");
  const job = await prisma.aiJob.create({
    data: {
      userId: account.id,
      entityType: "AI_INGESTION",
      entityId: input.id,
      ingestionInputId: input.id,
      status: "COMPLETED",
      completedAt: new Date(),
      metadata: { addToMeal: false, createRecipe: true, outcome: { recipeId: recipe.id, recipeName: recipe.name } },
    },
  });
  await prisma.aiProposal.create({
    data: {
      jobId: job.id,
      confidence: "high",
      proposed: { components: [{ name: "Kartoffeln", quantity: 200, unit: "g", estimatedGrams: 200 }], warnings: [] },
      provenance: {},
    },
  });

  await page.goto(`/ai-review/${input.id}`);
  await expect(page.getByText("Kartoffeln")).toBeVisible();
  // The recipe is offered as a link rather than as a destination: the draft
  // exists whether or not the meal behind it has been decided.
  await expect(page.getByRole("link", { name: /Ofengemüse spät/ })).toBeVisible();

  // Long enough for a redirect to have happened if one were going to.
  await page.waitForTimeout(5000);
  await expect(page).toHaveURL(new RegExp(`/ai-review/${input.id}$`));
});

test("a failed run stays in the recipe list, says why, and re-runs from there", async ({ page }) => {
  // When Ollama cannot be reached the job burns its retries and ends FAILED,
  // and the stand-in used to disappear with it: no recipe, no error, nothing to
  // retry, so the submitted work looked silently thrown away.
  const user = await registerAndOnboard(page);
  await completeOnboarding(page);
  const account = await accountOf(user.username);

  const record = await prisma.aiIngestionInput.create({
    data: { userId: account.id, intent: "RECIPE", text: "Hüttenkäse-Pizza", servings: 2 },
  });
  const job = await prisma.aiJob.create({
    data: {
      userId: account.id,
      entityType: "AI_INGESTION",
      entityId: record.id,
      ingestionInputId: record.id,
      status: "FAILED",
      failedAt: new Date(),
      retryCount: 2,
      failureKind: "MODEL_UNREACHABLE",
      errorMessage: "Ollama request failed",
    },
  });

  await page.goto("/foods");
  const row = page.locator(".ai-placeholder-failed").filter({ hasText: "Hüttenkäse-Pizza" });
  await expect(row).toBeVisible();
  await expect(row.getByText(/fehlgeschlagen|failed/i).first()).toBeVisible();
  await expect(row.getByText(/Ollama/)).toBeVisible();

  await row.getByRole("button", { name: /erneut versuchen|re-run/i }).click();

  // Back on the queue with a fresh budget, and the row says so instead of
  // reporting the failure it has just been given another attempt at.
  await expect
    .poll(async () => (await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, retryCount: true } })))
    .toEqual({ status: "QUEUED", retryCount: 0 });
  await expect(page.getByText(/In der Warteschlange|Queued/i)).toBeVisible();
});
