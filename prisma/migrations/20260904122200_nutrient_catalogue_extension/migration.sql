-- Nutrient catalogue extension for the bundled reference databases.
--
-- BLS 4.0 publishes 138 nutrient components and USDA FoodData Central 247;
-- NutriCore's canonical catalogue carried 33. These 14 keys are the ones at
-- least one bundled source states directly, with no derivation and no unit
-- ambiguity, so importing them cannot invent a number. Everything else BLS and
-- USDA carry - the individual amino acids and the fatty-acid spectrum - stays
-- out of the catalogue deliberately: it would triple the nutrient table
-- without changing a single diary total.
--
-- Same shape as 20260830010000_nutrient_catalogue: the id is the key, and the
-- upsert makes re-running a migration harmless.

INSERT INTO "NutrientDefinition" ("id", "key", "nameDe", "nameEn", "canonicalUnit", "category", "sortOrder")
VALUES
  ('transFat', 'transFat', 'trans-Fettsäuren', 'Trans fat', 'g', 'secondary', 65),
  ('omega3', 'omega3', 'Omega-3-Fettsäuren', 'Omega-3 fatty acids', 'g', 'secondary', 82),
  ('omega6', 'omega6', 'Omega-6-Fettsäuren', 'Omega-6 fatty acids', 'g', 'secondary', 84),
  ('starch', 'starch', 'Stärke', 'Starch', 'g', 'secondary', 95),
  ('polyols', 'polyols', 'Zuckeralkohole', 'Polyols', 'g', 'secondary', 96),
  ('water', 'water', 'Wasser', 'Water', 'g', 'secondary', 105),
  ('alcohol', 'alcohol', 'Alkohol', 'Alcohol', 'g', 'secondary', 125),
  ('cholesterol', 'cholesterol', 'Cholesterin', 'Cholesterol', 'mg', 'secondary', 130),
  ('chloride', 'chloride', 'Chlorid', 'Chloride', 'mg', 'mineral', 245),
  ('iodine', 'iodine', 'Iod', 'Iodine', 'µg', 'mineral', 285),
  ('fluoride', 'fluoride', 'Fluorid', 'Fluoride', 'µg', 'mineral', 290),
  ('chromium', 'chromium', 'Chrom', 'Chromium', 'µg', 'mineral', 292),
  ('molybdenum', 'molybdenum', 'Molybdän', 'Molybdenum', 'µg', 'mineral', 294),
  ('biotin', 'biotin', 'Biotin (B7)', 'Biotin (B7)', 'µg', 'vitamin', 375)
ON CONFLICT ("key") DO UPDATE SET
  "nameDe" = EXCLUDED."nameDe",
  "nameEn" = EXCLUDED."nameEn",
  "canonicalUnit" = EXCLUDED."canonicalUnit",
  "category" = EXCLUDED."category",
  "sortOrder" = EXCLUDED."sortOrder";
