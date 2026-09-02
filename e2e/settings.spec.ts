import { expect, test } from "@playwright/test";
import { completeOnboarding, mealRowTrigger, registerAndOnboard } from "./helpers";

test.beforeEach(async ({ page }) => {
  await registerAndOnboard(page);
  await completeOnboarding(page);
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

  await page.goto("/progress");
  await expect(composition).toBeVisible();
  await expect(shape).toBeVisible();

  // Its own form, so saving it cannot disturb the language or profile fields.
  const panelForm = page.locator("form").filter({ has: page.locator("#showBodyShape") });
  const save = async () => {
    await panelForm.getByRole("button", { name: /speichern|save/i }).click();
    await expect(page.getByRole("status")).toBeVisible();
  };

  await page.goto("/settings");
  await expect(page.locator("#showBodyComposition")).toBeChecked();
  await expect(page.locator("#showBodyShape")).toBeChecked();

  await page.locator("#showBodyShape").uncheck();
  await save();

  await page.goto("/progress");
  await expect(composition).toBeVisible();
  await expect(shape).toBeHidden();

  await page.goto("/settings");
  await page.locator("#showBodyComposition").uncheck();
  await save();

  // With both off the card keeps its head and check-in button, and says why it
  // is empty rather than showing a blank frame.
  await page.goto("/progress");
  await expect(composition).toBeHidden();
  await expect(page.getByText(/beide visualisierungen sind ausgeblendet/i)).toBeVisible();

  // Nothing was deleted: switching them back on restores both.
  await page.goto("/settings");
  await page.locator("#showBodyComposition").check();
  await page.locator("#showBodyShape").check();
  await save();

  await page.goto("/progress");
  await expect(composition).toBeVisible();
  await expect(shape).toBeVisible();
});

test("personal data can be exported as JSON and CSV", async ({ page }) => {
  await page.goto("/settings");

  const json = await page.request.get("/api/export/json");
  expect(json.status()).toBe(200);
  const payload = await json.json();
  expect(payload.format).toBe("nutricore.export");
  expect(payload.formatVersion).toBe(1);
  // The export must never carry credentials.
  expect(JSON.stringify(payload)).not.toContain("passwordHash");

  const csv = await page.request.get("/api/export/diary.csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("date,meal,food");
});
