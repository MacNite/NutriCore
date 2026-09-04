-- Optional personal goals for every catalogue nutrient. JSON keeps this tied to
-- the extensible nutrient catalogue rather than requiring a column per nutrient.
ALTER TABLE "NutritionTarget" ADD COLUMN "manualNutrients" JSONB;
