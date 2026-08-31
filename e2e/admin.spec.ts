import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { completeOnboarding, registerAndOnboard } from "./helpers";

const prisma = new PrismaClient();
test.afterAll(async () => prisma.$disconnect());

test("an administrator reaches the panel from settings and gets an invitation link", async ({ page }) => {
  const user = await registerAndOnboard(page);
  await completeOnboarding(page);

  // Only the first account of an installation is made an administrator, and this
  // suite runs against a database that already has accounts, so grant the role.
  await prisma.user.update({ where: { username: user.username }, data: { role: "ADMIN" } });

  await page.goto("/settings");
  await page.getByRole("link", { name: /^administration$/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: /^administration$/i })).toBeVisible();

  const invitee = `invitee${Date.now().toString(36)}@example.test`;
  await page.getByLabel(/^e-?mail$/i).fill(invitee);
  await page.getByRole("button", { name: /einladung erstellen|create invitation/i }).click();

  // The link is shown once and is the only way an invitation reaches anyone,
  // so it has to be on screen and complete.
  const link = page.getByLabel(/einladungslink|invitation link/i);
  await expect(link).toBeVisible();
  await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9_-]{20,}$/);

  await expect(page.getByText(invitee)).toBeVisible();
});

test("a non-administrator is turned away from the admin panel", async ({ page }) => {
  await registerAndOnboard(page);
  await completeOnboarding(page);

  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /^administration$/i })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
});
