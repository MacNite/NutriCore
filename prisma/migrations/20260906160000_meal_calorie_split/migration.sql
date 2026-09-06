-- A per-meal share of the day's calorie allowance.
--
-- There is no established correct division of the day. The DGE states that the
-- evidence supports no recommendation on how a healthy person should spread
-- intake, and the front-loading trials disagree with one another. So the split
-- is guidance the reader chooses: `showMealTargets` defaults to false, and an
-- existing account sees nothing new until it is switched on.
--
-- The four shares are stored as whole percent and default to the classic
-- 25/30/25/20 distribution taught alongside the DGE's three-to-five-meal
-- advice. They are kept summing to 100 by the action that writes them rather
-- than by a constraint here, so that a future fifth meal does not require a
-- migration to re-balance every existing row.

ALTER TABLE "public"."UserProfile"
  ADD COLUMN "showMealTargets" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mealSplitBreakfast" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "mealSplitLunch" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "mealSplitDinner" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "mealSplitSnacks" INTEGER NOT NULL DEFAULT 20;
