import { expect, test } from "@playwright/test";
import { completeOnboarding, registerAndOnboard } from "./helpers";

test.beforeEach(async ({ page }) => {
  await registerAndOnboard(page);
  await completeOnboarding(page);
});

test("the interface can be switched between German and English", async ({ page }) => {
  await page.goto("/settings");

  // The onboarding default is German.
  await expect(page.getByRole("heading", { name: /einstellungen/i })).toBeVisible();

  await page.getByLabel(/sprache|language/i).last().selectOption("en");
  await page
    .locator("form")
    .filter({ has: page.getByLabel(/enable ai|ki-funktionen/i) })
    .getByRole("button", { name: /speichern|save/i })
    .click();

  await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.goto("/diary");
  await expect(page.getByRole("heading", { name: /^diary$/i })).toBeVisible();
  // The meal heading, not the meal <option> in the quick-add form: options in a
  // collapsed <select> are never visible, and they precede the headings in the DOM.
  await expect(page.getByRole("heading", { name: /^breakfast$/i })).toBeVisible();
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

test("diagnostics reports service status without revealing secrets", async ({ page }) => {
  await page.goto("/settings/diagnostics");
  await expect(page.getByRole("heading", { name: /diagnose|diagnostics/i })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /datenbank|database/i })).toBeVisible();

  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toContain("0123456789abcdef");
});
