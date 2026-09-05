-- Marks the nutrient values the AI backfill wrote, so a dataset import can tell
-- them from measured ones.
--
-- `FoodNutrient.origin` already records how a dataset obtained a value, per
-- nutrient. Enrichment now writes 'AI_ENRICHMENT' there, but every value it
-- wrote before this migration carries NULL and is indistinguishable from a
-- dataset row - which means the next import would delete it, as it always did.
--
-- The evidence for the backfill is the audit record enrichment already keeps:
-- an AI_ENRICHMENT FoodSource whose metadata lists the nutrient keys that run
-- filled. Only rows named by such a record, still holding a value, and not
-- already attributed to a dataset are touched.
--
-- Data-only: no schema change, and safe to run on a database that has never
-- been enriched, where it matches nothing.
UPDATE "public"."FoodNutrient" AS fn
SET "origin" = 'AI_ENRICHMENT'
FROM "public"."FoodSource" AS fs
WHERE fs."foodId" = fn."foodId"
  AND fs."provider" = 'AI_ENRICHMENT'
  AND fn."origin" IS NULL
  AND fn."value" IS NOT NULL
  AND jsonb_typeof(fs."metadata" -> 'nutrientKeys') = 'array'
  AND fs."metadata" -> 'nutrientKeys' @> to_jsonb(fn."nutrientKey");
