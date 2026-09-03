import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { completeOnboarding, registerAndOnboard } from "./helpers";

const prisma = new PrismaClient();
test.afterAll(async () => prisma.$disconnect());

// Its own file rather than diary.spec.ts: the account has to be known by name
// to switch its AI off, and that file's beforeEach signs a user in already -
// registering a second one from inside a test only redirects away from /register.
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
