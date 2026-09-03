import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { completeOnboarding, mealRowTrigger, registerAndOnboard } from "./helpers";

const prisma = new PrismaClient();
test.afterAll(async () => prisma.$disconnect());

test("the dashboard quick-meal button opens the diary AI form", async ({ page }) => {
  await page.getByRole("button", { name: /quick meal|schnelle mahlzeit/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/describe your meal|beschreibe deine mahlzeit/i)).toBeVisible();
  await expect(dialog.getByLabel(/meal photo|mahlzeitenfoto/i)).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  await expect(dialog.getByLabel(/describe your meal|beschreibe deine mahlzeit/i)).not.toHaveAttribute("required", "");
  await expect(dialog.getByLabel(/^meal$|^mahlzeit$/i)).toBeVisible();
});

// The browser submits the untouched file input as a zero-byte part, which the
// server action must read as "no image" rather than as an empty upload.
test("a quick meal with only a URL is queued instead of failing on the untouched image input", async ({ page }) => {
  await page.getByRole("button", { name: /quick meal|schnelle mahlzeit/i }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/recipe url|rezept-url/i).fill("https://example.com/rezept");
  await dialog.getByRole("button", { name: /save and queue enrichment|speichern und anreicherung einreihen/i }).click();

  await page.waitForURL(/\/ai-review\/[^/]+\?queued=1$/);
  await expect(page.getByText(/is empty|ist leer/i)).toHaveCount(0);
});

test("meal rows open the correct editor without leaving Today", async ({ page }) => {
  await mealRowTrigger(page, /lunch|mittagessen/i).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("dialog", { name: /lunch|mittagessen/i })).toBeVisible();
});

test("a meal panel search logs a result and reopens the same panel", async ({ page }) => {
  await page.goto("/foods/new");
  await page.getByLabel(/^name$/i).first().fill("Panel Banane");
  await page.getByLabel(/^energy \(kcal\)|^energie \(kcal\)/i).fill("90");
  await page.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await page.goto("/");

  const row = mealRowTrigger(page, /lunch|mittagessen/i);
  await row.locator("xpath=following-sibling::button").click();
  const dialog = page.getByRole("dialog", { name: /lunch|mittagessen/i });
  const search = dialog.getByRole("combobox");
  await expect(search).toBeFocused();
  await search.fill("Panel Banane");
  await expect(dialog.getByRole("option", { name: /Panel Banane/i })).toBeVisible();
  await dialog.getByRole("option", { name: /Panel Banane/i }).click();

  // Today carries an "add to <meal>" button per row, which shares its name with
  // the food page's log button: the locator only becomes unambiguous once the
  // result has actually opened.
  await page.waitForURL(/\/foods\/[^/]+\?/);
  await page.getByRole("button", { name: /add to|hinzufügen/i }).click();
  await expect(page).toHaveURL(/editMeal=LUNCH/);
  await expect(page.getByRole("dialog", { name: /lunch|mittagessen/i })).toBeVisible();
});

test("Diary is absent from navigation and its legacy URL preserves dates", async ({ page }) => {
  await expect(page.locator(".nav, .bottom-nav").getByText(/^diary$|^tagebuch$/i)).toHaveCount(0);
  await page.goto("/diary?date=2026-08-30");
  await expect(page).toHaveURL(/\/\?date=2026-08-30$/);
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
  await page.goto("/");
  await expect(page.getByText("Testbrot").first()).toBeVisible();
  await expect(page.getByText(/500 kcal/).first()).toBeVisible();
  await page.getByRole("button", { name: /view all|alle anzeigen/i }).click();
  const microDialog = page.getByRole("dialog", { name: /micronutrients|mikronährstoffe/i });
  await expect(microDialog.locator(".micro-indicator").first()).toBeVisible();
  await microDialog.getByRole("button", { name: /^close$|^schließen$/i }).click();

  // Editing the amount rescales the entry. Entries live inside the meal's dialog now.
  await mealRowTrigger(page, /dinner|abendessen/i).click();
  const mealDialog = page.getByRole("dialog", { name: /dinner|abendessen/i });
  await mealDialog.getByRole("button", { name: /edit|bearbeiten/i }).first().click();
  await mealDialog.getByLabel(/^amount$|^menge$/i).first().fill("100");
  await mealDialog.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await expect(mealDialog.getByText(/250 kcal/).first()).toBeVisible();
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

  await page.goto("/");
  await expect(page.getByText(/100 kcal/).first()).toBeVisible();
});

test("Today can navigate between days", async ({ page }) => {
  await page.goto("/");
  const heading = page.locator(".date-nav strong");
  const today = await heading.textContent();

  await page.getByRole("link", { name: /previous day|vorheriger tag/i }).click();
  await expect(heading).not.toHaveText(today ?? "");

  await page.getByRole("link", { name: /next day|nächster tag/i }).click();
  await expect(heading).toHaveText(today ?? "");
});

test("activity entries can be added, edited and deleted in the Today dialog", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /sport & activity|sport & aktivität/i }).click();
  const panel = page.getByRole("dialog", { name: /sport & activity|sport & aktivität/i });
  await panel.getByRole("button", { name: /^add$|^hinzufügen$/i }).click();
  await panel.getByLabel(/^activity$|^aktivität$/i).selectOption("walking");
  await panel.getByLabel(/^intensity$|^intensität$/i).selectOption("brisk");
  await panel.getByLabel(/duration|dauer/i).fill("35");
  await panel.getByRole("button", { name: /^save$|^speichern$/i }).click();
  await expect(panel.getByText(/walking|gehen/i)).toBeVisible();
  await expect(panel.getByText(/35 min/i)).toBeVisible();
  await expect(panel.getByText(/kcal/i).last()).toBeVisible();

  const diaryPanel = panel;
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

test("the quick-meal button is gone once the user switches AI off", async ({ page }) => {
  // The quick meal is an AI run and nothing else, but it was the one entry
  // point that never asked whether the user wanted AI at all: with the switch
  // off, the floating button still queued an extraction.
  const user = await registerAndOnboard(page);
  await completeOnboarding(page);
  const quickMeal = page.getByRole("button", { name: /quick meal|schnelle mahlzeit/i });
  await expect(quickMeal).toBeVisible();

  const account = await prisma.user.findUniqueOrThrow({ where: { username: user.username }, select: { id: true } });
  await prisma.userProfile.update({ where: { userId: account.id }, data: { aiEnabled: false } });

  await page.goto("/");
  await expect(quickMeal).toHaveCount(0);
});
