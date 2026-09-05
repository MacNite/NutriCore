import { expect, test } from "@playwright/test";
import { completeOnboarding, registerAndOnboard } from "./helpers";

/**
 * The import reads the file in the browser, so the parts that matter here are
 * the ones no unit test can reach: that `DecompressionStream` and the streaming
 * reader survive the real Content-Security-Policy, and that a preview appears
 * before anything is written.
 */
test.describe("importing a health export", () => {
  test("previews an Apple export and imports it on confirm", async ({ page }) => {
    await registerAndOnboard(page);
    await completeOnboarding(page);

    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/settings");
    await page.getByLabel(/export file|exportdatei/i).setInputFiles("src/server/__fixtures__/apple-health-export.zip");

    // The preview names what would change, before writing anything.
    await expect(page.getByRole("button", { name: /import \d+ readings|\d+ messwerte importieren/i })).toBeVisible();
    // The summary line, not the card heading, which also names both platforms.
    await expect(page.getByText(/read from apple health|aus apple health gelesen/i)).toBeVisible();

    // Onboarding recorded a weight and a height, so both are protected.
    await expect(page.getByText(/recorded by hand|selbst erfasst/i)).toBeVisible();

    await page.getByRole("button", { name: /import \d+ readings|\d+ messwerte importieren/i }).click();
    await expect(page.getByText(/imported \d+ readings|\d+ messwerte importiert/i)).toBeVisible();

    // A CSP violation surfaces as a console error, which is the thing this
    // test exists to catch.
    expect(errors.filter((text) => /Content Security Policy|CSP/i.test(text))).toEqual([]);
  });

  test("reads a Health Connect database", async ({ page }) => {
    await registerAndOnboard(page);
    await completeOnboarding(page);

    await page.goto("/settings");
    await page.getByLabel(/export file|exportdatei/i).setInputFiles("src/server/__fixtures__/health-connect-export.zip");

    await expect(page.getByText(/read from health connect|aus health connect gelesen/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /import \d+ readings|\d+ messwerte importieren/i })).toBeVisible();
  });

  test("says so when the file is not a health export", async ({ page }) => {
    await registerAndOnboard(page);
    await completeOnboarding(page);

    await page.goto("/settings");
    await page.getByLabel(/export file|exportdatei/i).setInputFiles("package.json");

    // Scoped to the card's own notice: Next's route announcer is also role="alert".
    await expect(page.locator(".notice-error")).toContainText(/does not look like|sieht nicht nach/i);
  });
});
