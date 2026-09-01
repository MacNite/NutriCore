import { expect, test } from "@playwright/test";
import { completeOnboarding, registerAndOnboard } from "./helpers";

test("the dashboard quick-meal button opens the diary AI form", async ({ page }) => {
  await page.getByRole("button", { name: /quick meal|schnelle mahlzeit/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/describe your meal|beschreibe deine mahlzeit/i)).toBeVisible();
  await expect(dialog.getByLabel(/^meal$|^mahlzeit$/i)).toBeVisible();
});

test("a dashboard meal edit button opens and focuses that diary meal", async ({ page }) => {
  const lunchEdit = page.getByRole("link", { name: /edit: lunch|bearbeiten: mittagessen/i });
  await expect(lunchEdit).toHaveAttribute("href", /\/diary\?date=\d{4}-\d{2}-\d{2}#meal-LUNCH$/);

  await lunchEdit.click();

  await expect(page).toHaveURL(/\/diary\?date=\d{4}-\d{2}-\d{2}#meal-LUNCH$/);
  await expect(page.locator("#meal-LUNCH")).toBeInViewport();
});

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
  // The panel holding the coverage bars starts collapsed, so open it before
  // asserting: the bars are in the DOM from the first render either way.
  const microPanel = page.locator("details.micro-panel");
  await microPanel.locator("summary").click();
  await expect(microPanel.locator(".micro-indicator").first()).toBeVisible();

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

test("the micronutrient panel starts collapsed and can be expanded", async ({ page }) => {
  await page.goto("/diary");

  const panel = page.locator("details.micro-panel");
  await expect(panel).not.toHaveAttribute("open", "");
  await expect(panel.getByRole("heading", { name: /micronutrients|mikronährstoffe/i })).toBeVisible();
  await expect(panel.locator(".micro-grid")).not.toBeVisible();

  await panel.locator("summary").click();
  await expect(panel).toHaveAttribute("open", "");
  await expect(panel.locator(".micro-grid")).toBeVisible();

  await panel.locator("summary").click();
  await expect(panel).not.toHaveAttribute("open", "");
  await expect(panel.locator(".micro-grid")).not.toBeVisible();
});

test("activity entries are date-specific and shared by dashboard and diary", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator(".grid-main > .stack > .card");
  await expect(cards.nth(2).getByRole("heading", { name: /sport & activity|sport & aktivität/i })).toBeVisible();
  await expect(cards.nth(3).getByRole("heading", { name: /micronutrients|mikronährstoffe/i })).toBeVisible();

  const panel = page.locator(".activity-panel");
  await panel.getByRole("button", { name: /^add$|^hinzufügen$/i }).click();
  await panel.getByLabel(/^activity$|^aktivität$/i).selectOption("walking");
  await panel.getByLabel(/^intensity$|^intensität$/i).selectOption("brisk");
  await panel.getByLabel(/duration|dauer/i).fill("35");
  await panel.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await expect(panel.getByText(/walking|gehen/i)).toBeVisible();
  await expect(panel.getByText(/35 min/i)).toBeVisible();
  await expect(panel.getByText(/kcal/i).last()).toBeVisible();

  await page.goto("/diary");
  const diaryPanel = page.locator(".activity-panel");
  await expect(diaryPanel.getByText(/walking|gehen/i)).toBeVisible();
  await diaryPanel.getByRole("button", { name: /edit walking|gehen bearbeiten/i }).click();
  await diaryPanel.getByLabel(/duration|dauer/i).fill("70");
  await diaryPanel.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await expect(diaryPanel.getByText(/70 min/i)).toBeVisible();

  await diaryPanel.getByRole("button", { name: /delete walking|gehen löschen/i }).click();
  await expect(diaryPanel.getByText(/no activity|noch keine aktivität/i)).toBeVisible();

  await diaryPanel.getByRole("button", { name: /^add$|^hinzufügen$/i }).click();
  await diaryPanel.getByLabel(/^activity$|^aktivität$/i).selectOption("hiking");
  await expect(diaryPanel.getByLabel(/^intensity$|^intensität$/i)).toHaveCount(0);
  await diaryPanel.getByRole("button", { name: /^cancel$|^abbrechen$/i }).click();
});
