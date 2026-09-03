import { expect, test } from "@playwright/test";
import { completeOnboarding, mealRowTrigger, registerAndOnboard } from "./helpers";

test.beforeEach(async ({ page }) => {
  await registerAndOnboard(page);
  await completeOnboarding(page);
});

test("settings are available from the account button but absent from primary navigation", async ({ page }) => {
  await expect(page.locator(".nav, .bottom-nav").getByText(/^settings$|^einstellungen$/i)).toHaveCount(0);

  const accountButton = page.locator("a.avatar");
  await expect(accountButton).toHaveAttribute("href", "/settings");
  await accountButton.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: /^settings$|^einstellungen$/i })).toBeVisible();
});

test("the interface can be switched between German and English", async ({ page }) => {
  await page.goto("/settings");

  // The onboarding default is German.
  await expect(page.getByRole("heading", { name: /einstellungen/i })).toBeVisible();

  // The language selector has its own form now that the AI switches moved to
  // /admin, so the save button is scoped by that field rather than by them.
  const languageForm = page.locator("form").filter({ has: page.locator("#settings-language") });
  await languageForm.getByLabel(/sprache|language/i).selectOption("en");
  await languageForm.getByRole("button", { name: /speichern|save/i }).click();

  await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^diary$/i })).toBeVisible();
  // The meal name inside the meal row's trigger button, not the meal <option> in
  // the quick-add form: options in a collapsed <select> are never visible.
  await expect(mealRowTrigger(page, /breakfast/i)).toBeVisible();
});

test("the theme can be set to light, dark or system and survives navigation", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /dunkel|dark/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/diary");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: /hell|light/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("each body-progress visualisation can be switched off on its own", async ({ page }) => {
  // Onboarding recorded a weight, which is a session, so the card is drawn.
  const composition = page.locator(".body-micro-head", { hasText: /körperzusammensetzung/i });
  const shape = page.locator(".body-micro-head", { hasText: /^körperform$/i });
  const bodyCard = page.locator("#body-hero-heading");
  const keyFigures = page.getByRole("heading", { name: /^kennzahlen$/i });
  const table = page.getByRole("heading", { name: /messwerte im detail/i });
  const weight = page.getByRole("heading", { name: /^gewicht$/i });
  const nutrition = page.getByRole("heading", { name: /^ernährung$/i });
  // Body fat belongs to composition, the waist to shape: the detail table is
  // the readable proof of which switch each measurement answers to.
  // The fold toggle is small-screen only; at this viewport the table is open.
  const bodyFatRow = page.getByRole("rowheader", { name: /^körperfett$/i });
  const waistRow = page.getByRole("rowheader", { name: /^taille$/i });

  await page.goto("/progress");
  await expect(composition).toBeVisible();
  await expect(shape).toBeVisible();
  await expect(keyFigures).toBeVisible();
  await expect(bodyFatRow).toBeVisible();
  await expect(waistRow).toBeVisible();

  // Its own form, so saving it cannot disturb the language or profile fields.
  const panelForm = page.locator("form").filter({ has: page.locator("#showBodyShape") });
  const save = async () => {
    await panelForm.getByRole("button", { name: /speichern|save/i }).click();
    await expect(page.getByRole("status")).toBeVisible();
  };

  await page.goto("/settings");
  await expect(page.locator("#showBodyComposition")).toBeChecked();
  await expect(page.locator("#showBodyShape")).toBeChecked();

  // Composition only: the key figures are all waist-derived, so they go too,
  // and the table keeps the four composition rows without the circumferences.
  await page.locator("#showBodyShape").uncheck();
  await save();

  await page.goto("/progress");
  await expect(composition).toBeVisible();
  await expect(shape).toBeHidden();
  await expect(keyFigures).toBeHidden();
  await expect(bodyFatRow).toBeVisible();
  await expect(waistRow).toBeHidden();

  // Shape only: the mirror image.
  await page.goto("/settings");
  await page.locator("#showBodyShape").check();
  await page.locator("#showBodyComposition").uncheck();
  await save();

  await page.goto("/progress");
  await expect(shape).toBeVisible();
  await expect(keyFigures).toBeVisible();
  await expect(waistRow).toBeVisible();
  await expect(bodyFatRow).toBeHidden();

  // Both off: body progress goes entirely, weight and nutrition stay.
  await page.goto("/settings");
  await page.locator("#showBodyShape").uncheck();
  await save();

  await page.goto("/progress");
  await expect(bodyCard).toBeHidden();
  await expect(keyFigures).toBeHidden();
  await expect(table).toBeHidden();
  await expect(weight).toBeVisible();
  await expect(nutrition).toBeVisible();

  // Nothing was deleted: switching them back on restores every panel and row.
  await page.goto("/settings");
  await page.locator("#showBodyComposition").check();
  await page.locator("#showBodyShape").check();
  await save();

  await page.goto("/progress");
  await expect(composition).toBeVisible();
  await expect(shape).toBeVisible();
  await expect(keyFigures).toBeVisible();
  await expect(bodyFatRow).toBeVisible();
  await expect(waistRow).toBeVisible();
});

test("personal data can be exported as JSON and CSV", async ({ page }) => {
  await page.goto("/settings");

  const json = await page.request.get("/api/export/json");
  expect(json.status()).toBe(200);
  const payload = await json.json();
  expect(payload.format).toBe("nutricore.export");
  expect(payload.formatVersion).toBe(2);
  // Version 2 carries the body timeline, which version 1 omitted entirely.
  expect(payload).toHaveProperty("bodyMeasurements");
  expect(payload).toHaveProperty("bodyScans");
  // The export must never carry credentials.
  expect(JSON.stringify(payload)).not.toContain("passwordHash");
  // Nor the captured images, which are deleted minutes after a scan runs.
  expect(JSON.stringify(payload)).not.toContain("frontData");

  const csv = await page.request.get("/api/export/diary.csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("date,meal,food");
});
