import { expect, test } from "@playwright/test";
import { completeOnboarding, registerAndOnboard, uniqueUser } from "./helpers";

/**
 * Recipe sharing, end to end and across two accounts.
 *
 * The service tests prove the boundary holds; this one proves the buttons that
 * reach it are wired up - publishing from the author's recipe, the shared list,
 * and a second account getting a copy it owns.
 */
test("a recipe published by one member can be saved by another", async ({ page, context }) => {
  const stamp = Date.now().toString(36);
  const foodName = `Sharefood ${stamp}`;
  const recipeName = `Sharerecipe ${stamp}`;
  const publishedTitle = `Published ${stamp}`;

  // --- The author -------------------------------------------------------
  await registerAndOnboard(page);
  await completeOnboarding(page);

  await page.goto("/foods/new");
  await page.getByLabel(/^name$/i).first().fill(foodName);
  await page.getByLabel(/^energy \(kcal\)|^energie \(kcal\)/i).fill("150");
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await page.waitForURL(/\/foods\/(?!new)[^/]+/);

  await page.goto("/recipes/new");
  await page.getByLabel(/^name$/i).first().fill(recipeName);
  await page.getByLabel(/^servings$|^portionen$/i).fill("2");
  await page.getByLabel(/search|suche/i).first().fill(foodName);
  await page.getByRole("button", { name: /^add$|^hinzufügen$/i }).first().click();
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await page.waitForURL(/\/recipes\/(?!new|shared)[^/]+$/);

  // The private title is a starting point; what goes public is edited here.
  await page.getByLabel(/^title$|^titel$/i).fill(publishedTitle);
  await page.getByRole("button", { name: /^publish$|^veröffentlichen$/i }).click();
  await page.waitForURL(/\/recipes\/shared\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(publishedTitle);

  // --- Another member ---------------------------------------------------
  const reader = context ? await context.browser()?.newContext() : null;
  const readerPage = await (reader ?? context).newPage();
  const other = uniqueUser();
  await registerAndOnboard(readerPage, other);
  await completeOnboarding(readerPage);

  await readerPage.goto("/recipes/shared");
  await expect(readerPage.getByRole("link", { name: publishedTitle })).toBeVisible();
  await readerPage.getByRole("link", { name: publishedTitle }).click();
  await readerPage.waitForURL(/\/recipes\/shared\/[^/]+$/);

  await readerPage.getByRole("button", { name: /save to my recipes|in meine rezepte übernehmen/i }).click();
  // The copy is the reader's own recipe, under their own recipes.
  await readerPage.waitForURL(/\/recipes\/(?!new|shared)[^/]+/);
  await expect(readerPage.getByRole("heading", { level: 1 })).toContainText(publishedTitle);
  await expect(readerPage.getByText(/saved from a recipe shared by|übernommen aus einem rezept/i)).toBeVisible();

  // And the food it was built from is now theirs to see, not a link to the
  // author's row.
  await readerPage.goto("/foods");
  await expect(readerPage.getByRole("link", { name: publishedTitle })).toBeVisible();

  await reader?.close();
});

test("withdrawing takes a recipe out of the shared list", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const foodName = `Withdrawfood ${stamp}`;
  const title = `Withdrawn ${stamp}`;

  await registerAndOnboard(page);
  await completeOnboarding(page);

  await page.goto("/foods/new");
  await page.getByLabel(/^name$/i).first().fill(foodName);
  await page.getByLabel(/^energy \(kcal\)|^energie \(kcal\)/i).fill("120");
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await page.waitForURL(/\/foods\/(?!new)[^/]+/);

  await page.goto("/recipes/new");
  await page.getByLabel(/^name$/i).first().fill(`Withdrawrecipe ${stamp}`);
  await page.getByLabel(/^servings$|^portionen$/i).fill("2");
  await page.getByLabel(/search|suche/i).first().fill(foodName);
  await page.getByRole("button", { name: /^add$|^hinzufügen$/i }).first().click();
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await page.waitForURL(/\/recipes\/(?!new|shared)[^/]+$/);

  await page.getByLabel(/^title$|^titel$/i).fill(title);
  await page.getByRole("button", { name: /^publish$|^veröffentlichen$/i }).click();
  await page.waitForURL(/\/recipes\/shared\/[^/]+$/);

  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^withdraw$|^zurückziehen$/i }).click();
  await page.waitForURL(/\/recipes\/shared$/);

  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});
