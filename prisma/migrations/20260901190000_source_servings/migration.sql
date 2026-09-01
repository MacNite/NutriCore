-- The source yield lets both AI entry points turn whole-recipe quantities into
-- one correctly sized portion without relying on the model to infer the yield.
ALTER TABLE "MealInput" ADD COLUMN "servings" DECIMAL(8,2) NOT NULL DEFAULT 1;
ALTER TABLE "RecipeImport" ADD COLUMN "servings" DECIMAL(8,2) NOT NULL DEFAULT 1;
