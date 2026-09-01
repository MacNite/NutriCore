import type { Page } from "@playwright/test";

let counter = 0;

export function uniqueUser() {
  counter += 1;
  const id = `${Date.now().toString(36)}${counter}`;
  return {
    displayName: `Test ${id}`,
    username: `user${id}`,
    email: `user${id}@example.test`,
    password: "a-long-enough-passphrase",
  };
}

export type TestUser = ReturnType<typeof uniqueUser>;

/** Registers a fresh account and completes onboarding. */
export async function registerAndOnboard(page: Page, user: TestUser = uniqueUser()) {
  await page.goto("/register");
  await page.getByLabel(/display name|anzeigename/i).fill(user.displayName);
  await page.getByLabel(/username|benutzername/i).fill(user.username);
  await page.getByLabel(/^email$|^e-mail$/i).fill(user.email);
  await page.getByLabel(/password|passwort/i).fill(user.password);
  await page.getByRole("button", { name: /create account|konto erstellen/i }).click();

  await page.waitForURL("**/onboarding");
  return user;
}

export async function completeOnboarding(page: Page) {
  await page.getByLabel(/date of birth|geburtsdatum/i).fill("1992-05-14");
  await page.getByLabel(/height|körpergröße/i).fill("178");
  await page.getByLabel(/current weight|aktuelles gewicht/i).fill("76.4");
  await page.getByLabel(/biological sex|biologisches geschlecht/i).selectOption("FEMALE");
  await page.getByRole("button", { name: /finish setup|einrichtung abschließen/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("onboarding"));
}

/**
 * The meal row's own trigger on Today. Each row also carries an "add to <meal>"
 * icon button that opens the same dialog, so matching the meal name by role
 * alone is ambiguous.
 */
export function mealRowTrigger(page: Page, meal: RegExp) {
  return page.locator("button.row-main-button").filter({ hasText: meal });
}
