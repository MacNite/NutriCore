import { expect, test } from "@playwright/test";
import { completeOnboarding, registerAndOnboard, uniqueUser } from "./helpers";

test("an anonymous visitor is sent to the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a new user can register, onboard and reach the dashboard", async ({ page }) => {
  await registerAndOnboard(page);
  await completeOnboarding(page);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/test/i);
});

test("a transparent calorie target is shown with every component", async ({ page }) => {
  await registerAndOnboard(page);
  await completeOnboarding(page);
  await page.goto("/settings");

  // BMR, activity multiplier, TDEE and the final target must all be visible.
  await expect(page.getByText(/basal metabolic rate|grundumsatz/i)).toBeVisible();
  await expect(page.getByText(/activity multiplier|aktivitätsfaktor/i)).toBeVisible();
  await expect(page.getByText(/estimated daily needs|geschätzter tagesbedarf/i)).toBeVisible();
  await expect(page.getByText(/estimates, not medical|schätzungen, keine medizinischen/i)).toBeVisible();
});

test("sign-in rejects a wrong password", async ({ page }) => {
  const user = await registerAndOnboard(page, uniqueUser());
  await completeOnboarding(page);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel(/^email$|^e-mail$/i).fill(user.email);
  await page.getByLabel(/password|passwort/i).fill("definitely-the-wrong-one");
  await page.getByRole("button", { name: /sign in|anmelden/i }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
