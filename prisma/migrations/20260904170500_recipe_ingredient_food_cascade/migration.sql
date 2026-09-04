-- Deleting an account must not be blocked by the account's own recipes.
--
-- `RecipeIngredient.foodId` has restricted deletes since the initial
-- migration. Every other reference to `Food` already cascades or nulls, and
-- the only thing that ever deletes a food a recipe uses is the account
-- cascade - `pruneExpiredProviderFoods` deliberately keeps a food a recipe
-- references, and nothing else deletes one at all. So the restrict protected
-- nothing and broke `deleteAccountAction` with a foreign-key violation for
-- every user who had built a recipe out of a food they created themselves.

ALTER TABLE "public"."RecipeIngredient" DROP CONSTRAINT "RecipeIngredient_foodId_fkey";

ALTER TABLE "public"."RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;
