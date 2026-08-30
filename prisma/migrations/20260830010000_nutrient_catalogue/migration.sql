-- The nutrient catalogue is reference data, not demo data.
--
-- Every FoodNutrient row has a foreign key onto NutrientDefinition.key, so a
-- database without these rows cannot store a single food. It therefore has to
-- be applied by a migration that every deployment runs, not by the optional
-- development seed.
--
-- The id is the key itself, which keeps this statement deterministic and
-- repeatable. Adding a nutrient means adding it to src/lib/nutrients.ts and
-- shipping a new migration; tests/nutrient-catalogue.test.ts fails if the two
-- ever drift apart.

INSERT INTO "NutrientDefinition" ("id", "key", "nameDe", "nameEn", "canonicalUnit", "category", "sortOrder")
VALUES
  ('energyKcal', 'energyKcal', 'Energie', 'Energy', 'kcal', 'energy', 10),
  ('energyKj', 'energyKj', 'Energie', 'Energy', 'kJ', 'energy', 20),
  ('protein', 'protein', 'Protein', 'Protein', 'g', 'macro', 30),
  ('carbohydrate', 'carbohydrate', 'Kohlenhydrate', 'Carbohydrates', 'g', 'macro', 40),
  ('fat', 'fat', 'Fett', 'Fat', 'g', 'macro', 50),
  ('saturatedFat', 'saturatedFat', 'gesättigte Fettsäuren', 'Saturated fat', 'g', 'secondary', 60),
  ('monounsaturatedFat', 'monounsaturatedFat', 'einfach ungesättigte Fettsäuren', 'Monounsaturated fat', 'g', 'secondary', 70),
  ('polyunsaturatedFat', 'polyunsaturatedFat', 'mehrfach ungesättigte Fettsäuren', 'Polyunsaturated fat', 'g', 'secondary', 80),
  ('sugar', 'sugar', 'Zucker', 'Sugar', 'g', 'secondary', 90),
  ('fiber', 'fiber', 'Ballaststoffe', 'Fibre', 'g', 'secondary', 100),
  ('sodium', 'sodium', 'Natrium', 'Sodium', 'g', 'secondary', 110),
  ('salt', 'salt', 'Salz', 'Salt', 'g', 'secondary', 120),
  ('calcium', 'calcium', 'Calcium', 'Calcium', 'mg', 'mineral', 200),
  ('iron', 'iron', 'Eisen', 'Iron', 'mg', 'mineral', 210),
  ('magnesium', 'magnesium', 'Magnesium', 'Magnesium', 'mg', 'mineral', 220),
  ('phosphorus', 'phosphorus', 'Phosphor', 'Phosphorus', 'mg', 'mineral', 230),
  ('potassium', 'potassium', 'Kalium', 'Potassium', 'mg', 'mineral', 240),
  ('zinc', 'zinc', 'Zink', 'Zinc', 'mg', 'mineral', 250),
  ('copper', 'copper', 'Kupfer', 'Copper', 'mg', 'mineral', 260),
  ('manganese', 'manganese', 'Mangan', 'Manganese', 'mg', 'mineral', 270),
  ('selenium', 'selenium', 'Selen', 'Selenium', 'µg', 'mineral', 280),
  ('vitaminA', 'vitaminA', 'Vitamin A', 'Vitamin A', 'µg', 'vitamin', 300),
  ('vitaminC', 'vitaminC', 'Vitamin C', 'Vitamin C', 'mg', 'vitamin', 310),
  ('vitaminD', 'vitaminD', 'Vitamin D', 'Vitamin D', 'µg', 'vitamin', 320),
  ('vitaminE', 'vitaminE', 'Vitamin E', 'Vitamin E', 'mg', 'vitamin', 330),
  ('vitaminK', 'vitaminK', 'Vitamin K', 'Vitamin K', 'µg', 'vitamin', 340),
  ('thiamin', 'thiamin', 'Thiamin (B1)', 'Thiamin (B1)', 'mg', 'vitamin', 350),
  ('riboflavin', 'riboflavin', 'Riboflavin (B2)', 'Riboflavin (B2)', 'mg', 'vitamin', 360),
  ('niacin', 'niacin', 'Niacin (B3)', 'Niacin (B3)', 'mg', 'vitamin', 370),
  ('pantothenicAcid', 'pantothenicAcid', 'Pantothensäure (B5)', 'Pantothenic acid (B5)', 'mg', 'vitamin', 380),
  ('vitaminB6', 'vitaminB6', 'Vitamin B6', 'Vitamin B6', 'mg', 'vitamin', 390),
  ('folate', 'folate', 'Folat', 'Folate', 'µg', 'vitamin', 400),
  ('vitaminB12', 'vitaminB12', 'Vitamin B12', 'Vitamin B12', 'µg', 'vitamin', 410)
ON CONFLICT ("key") DO UPDATE SET
  "nameDe" = EXCLUDED."nameDe",
  "nameEn" = EXCLUDED."nameEn",
  "canonicalUnit" = EXCLUDED."canonicalUnit",
  "category" = EXCLUDED."category",
  "sortOrder" = EXCLUDED."sortOrder";
