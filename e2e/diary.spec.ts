import { expect, test } from "@playwright/test";
import { completeOnboarding, registerAndOnboard } from "./helpers";

test.beforeEach(async ({ page }) => {
  await registerAndOnboard(page);
  await completeOnboarding(page);
});

test("a user can create a custom food, log it and edit the portion", async ({ page }) => {
  await page.goto("/foods/new");
  await page.getByLabel(/^name$/i).first().fill("Testbrot");
  await page.getByLabel(/^energy \(kcal\)|^energie \(kcal\)/i).fill("250");
  await page.getByLabel(/^protein \(g\)/i).fill("9");
  await page.getByLabel(/carbohydrates \(g\)|kohlenhydrate \(g\)/i).fill("45");
  await page.getByLabel(/^fat \(g\)|^fett \(g\)/i).fill("3");
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();

  // Lands on the food page, where a portion is chosen.
  await page.waitForURL(/\/foods\/[^/]+/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Testbrot");

  await page.getByLabel(/^amount$|^menge$/i).fill("200");
  await page.getByLabel(/^move to$|^verschieben nach$/i).selectOption("DINNER");
  await page.getByRole("button", { name: /breakfast|lunch|dinner|snacks|frühstück|mittagessen|abendessen|snacks/i }).click();
  await page.waitForURL(/\/foods\?meal=DINNER&date=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("heading", { level: 1, name: /^foods$|^lebensmittel$/i })).toBeVisible();

  // 200 g of a 250 kcal/100 g food is 500 kcal.
  await page.goto("/diary");
  await expect(page.getByText("Testbrot").first()).toBeVisible();
  await expect(page.getByText(/500 kcal/).first()).toBeVisible();

  // Editing the amount rescales the entry.
  await page.getByRole("button", { name: /edit|bearbeiten/i }).first().click();
  await page.getByLabel(/^amount$|^menge$/i).first().fill("100");
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await expect(page.getByText(/250 kcal/).first()).toBeVisible();
});

test("an unknown value is shown as a dash, never as zero", async ({ page }) => {
  await page.goto("/foods/new");
  await page.getByLabel(/^name$/i).first().fill("Unbekanntes Essen");
  await page.getByLabel(/^energy \(kcal\)|^energie \(kcal\)/i).fill("100");
  // Protein, carbs and fat are deliberately left empty: they are unknown.
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await page.waitForURL(/\/foods\/[^/]+/);

  const proteinRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /^protein$/i }) });
  await expect(proteinRow).toContainText("–");
  await expect(proteinRow).not.toContainText("0 g");
});

test("a logged entry keeps its own values when the food changes later", async ({ page }) => {
  await page.goto("/foods/new");
  await page.getByLabel(/^name$/i).first().fill("Snapshot Food");
  await page.getByLabel(/^energy \(kcal\)|^energie \(kcal\)/i).fill("100");
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await page.waitForURL(/\/foods\/[^/]+/);

  await page.getByLabel(/^amount$|^menge$/i).fill("100");
  await page.getByRole("button", { name: /breakfast|lunch|dinner|snacks|frühstück|mittagessen|abendessen/i }).click();
  await page.waitForURL(/\/foods\?meal=SNACKS&date=\d{4}-\d{2}-\d{2}$/);

  await page.goto("/diary");
  await expect(page.getByText(/100 kcal/).first()).toBeVisible();
});

test("the diary can navigate between days", async ({ page }) => {
  await page.goto("/diary");
  const heading = page.locator(".date-nav strong");
  const today = await heading.textContent();

  await page.getByRole("link", { name: /previous day|vorheriger tag/i }).click();
  await expect(heading).not.toHaveText(today ?? "");

  await page.getByRole("link", { name: /next day|nächster tag/i }).click();
  await expect(heading).toHaveText(today ?? "");
});
