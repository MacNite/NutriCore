/**
 * Repairs a decoded model answer before it is validated.
 *
 * Ollama constrains generation with a grammar derived from the JSON schema, and
 * that grammar enforces *shape only*: llama.cpp ignores numeric ranges, string
 * lengths and array bounds. So a model that does not know a weight writes `0`,
 * which `z.number().positive()` then rejects - discarding the entire meal over
 * one unknown value, even though `partitionComponents` already skips a component
 * without a usable weight. Repairing first keeps the parts the model did get
 * right and drops only what cannot be used.
 *
 * Every function here removes or clamps. None of them invents a value, and none
 * of them fills in nutrition: an absent number stays absent, so a component the
 * worker could not resolve is still reported as skipped rather than logged.
 *
 * Pure and dependency-free, so the rules can be tested directly.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A number the schema requires to be positive, or nothing at all. */
export function positiveOrAbsent(value: unknown, max: number): number | undefined {
  const numeric = typeof value === "string" ? Number(value.replace(",", ".").trim()) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric > max ? undefined : numeric;
}

/** A number the schema allows to be zero, or nothing at all. */
export function nonNegativeOrAbsent(value: unknown, max: number): number | undefined {
  const numeric = typeof value === "string" ? Number(value.replace(",", ".").trim()) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 0) return undefined;
  return numeric > max ? undefined : numeric;
}

/** Trimmed and cut to length, or nothing when there is no text left. */
export function textOrAbsent(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length ? trimmed : undefined;
}

/** Same, but an over-long string is kept as an empty one where the schema has a default. */
export const textOrEmpty = (value: unknown, max: number) => textOrAbsent(value, max) ?? "";

/** Drops every key whose value is `undefined`, so an optional field reads as absent. */
function compact<T extends Record<string, unknown>>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const stringList = (value: unknown, max: number, maxLength: number) =>
  asArray(value)
    .map((entry) => textOrAbsent(entry, maxLength))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, max);

const CONFIDENCE_BANDS = new Set(["high", "medium", "low"]);

/**
 * A confidence the model spelt its own way - "certain", "sure", "0.9" - becomes
 * the lowest band rather than failing the response. Reading it as anything
 * higher would overstate what the model actually said.
 */
export function confidenceBand(value: unknown): "high" | "medium" | "low" {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CONFIDENCE_BANDS.has(text) ? (text as "high" | "medium" | "low") : "low";
}

/** Repairs one meal or recipe component as `mealParseSchema` expects it. */
function repairComponent(value: unknown) {
  if (!isRecord(value)) return undefined;
  const name = textOrAbsent(value.name, 120);
  // A component with no name cannot be matched against anything, so it is not a
  // component; keeping it would only produce an unnamed skip in the review.
  if (!name) return undefined;
  return compact({
    name,
    quantity: positiveOrAbsent(value.quantity, 10000),
    unit: textOrAbsent(value.unit, 30),
    estimatedGrams: positiveOrAbsent(value.estimatedGrams, 10000),
    preparation: textOrAbsent(value.preparation, 80),
    // Dropped whole unless all four macronutrients are present: a partial block
    // would either fail validation or, filled with zeroes, understate the meal.
    nutritionPer100g: isRecord(value.nutritionPer100g) ? repairModelNutrition(value.nutritionPer100g) : undefined,
  });
}

export function repairMealParse(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    components: asArray(value.components)
      .map(repairComponent)
      .filter((component) => component !== undefined)
      .slice(0, 40),
    confidence: confidenceBand(value.confidence),
    warnings: stringList(value.warnings, 10, 200),
  };
}

/**
 * Repairs a nutrient extraction, keeping only the keys that were asked for.
 * A model handed a free-form object will happily name nutrients that do not
 * exist in the catalogue; those are dropped here rather than at the database.
 */
export function repairNutrientExtraction(allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return (value: unknown): unknown => {
    if (!isRecord(value)) return value;
    const source = isRecord(value.nutrients) ? value.nutrients : {};
    const nutrients: Record<string, number> = {};
    for (const [key, raw] of Object.entries(source)) {
      if (!allowed.has(key)) continue;
      // Per 100 g, nothing in the catalogue can exceed 100 g except energy.
      const repaired = nonNegativeOrAbsent(raw, key === "energyKcal" ? 900 : 100);
      if (repaired !== undefined) nutrients[key] = repaired;
    }
    return compact({ nutrients, servingSizeG: positiveOrAbsent(value.servingSizeG, 10000) });
  };
}

/** Repairs a research result as `researchResultSchema` expects it. */
export function repairResearchResult(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const ingredients = asArray(value.ingredients)
    .map((entry) => {
      if (!isRecord(entry)) return undefined;
      const name = textOrAbsent(entry.name, 200);
      const amount = positiveOrAbsent(entry.amount, 100_000);
      // Without a name or an amount there is nothing to match or to weigh.
      if (!name || amount === undefined) return undefined;
      const unit = typeof entry.unit === "string" ? entry.unit.trim().toLowerCase() : "";
      return {
        name,
        amount,
        unit: unit === "g" || unit === "ml" || unit === "piece" ? unit : "g",
        confidence: nonNegativeOrAbsent(entry.confidence, 1) ?? 0,
      };
    })
    .filter((entry) => entry !== undefined)
    .slice(0, 60);

  const nutrition = isRecord(value.nutritionPer100g) ? repairModelNutrition(value.nutritionPer100g) : undefined;

  return compact({
    kind: value.kind === "recipe" ? "recipe" : "food",
    name: textOrEmpty(value.name, 200) || "Unbenannt",
    language: value.language === "en" ? "en" : "de",
    description: textOrEmpty(value.description, 2000),
    ingredients,
    servings: positiveOrAbsent(value.servings, 100) ?? 1,
    estimatedServingWeightG: positiveOrAbsent(value.estimatedServingWeightG, 100_000),
    nutritionPer100g: nutrition,
    assumptions: stringList(value.assumptions, 20, 500),
    sources: asArray(value.sources)
      .map((entry) => {
        if (!isRecord(entry)) return undefined;
        const url = textOrAbsent(entry.url, 2000);
        if (!url || !/^https?:\/\//i.test(url)) return undefined;
        return { title: textOrEmpty(entry.title, 300), url };
      })
      .filter((entry) => entry !== undefined)
      .slice(0, 10),
    confidence: nonNegativeOrAbsent(value.confidence, 1) ?? 0,
    modelEstimated: value.modelEstimated === true,
  });
}

/**
 * The four macronutrients are required by `modelNutritionSchema`, so an
 * incomplete set has to be dropped whole: a partial object would fail
 * validation, and filling the gaps with zeroes would understate the dish.
 */
function repairModelNutrition(value: Record<string, unknown>) {
  const energyKcal = nonNegativeOrAbsent(value.energyKcal, 900);
  const protein = nonNegativeOrAbsent(value.protein, 100);
  const carbohydrate = nonNegativeOrAbsent(value.carbohydrate, 100);
  const fat = nonNegativeOrAbsent(value.fat, 100);
  if (energyKcal === undefined || protein === undefined || carbohydrate === undefined || fat === undefined)
    return undefined;

  return compact({
    energyKcal,
    protein,
    carbohydrate,
    fat,
    saturatedFat: nonNegativeOrAbsent(value.saturatedFat, 100),
    sugar: nonNegativeOrAbsent(value.sugar, 100),
    fiber: nonNegativeOrAbsent(value.fiber, 100),
    salt: nonNegativeOrAbsent(value.salt, 100),
  });
}

/** Repairs an imported recipe as `extractedRecipeSchema` expects it. */
export function repairExtractedRecipe(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    name: textOrEmpty(value.name, 200) || "Unbenanntes Rezept",
    description: textOrEmpty(value.description, 2000),
    servings: positiveOrAbsent(value.servings, 10_000) ?? 1,
    instructions: textOrEmpty(value.instructions, 20_000),
    ingredients: asArray(value.ingredients)
      .map((entry) => {
        if (!isRecord(entry)) return undefined;
        const name = textOrAbsent(entry.name, 120);
        const amount = positiveOrAbsent(entry.amount, 100_000);
        if (!name || amount === undefined) return undefined;
        return { name, amount, unit: textOrAbsent(entry.unit, 40) ?? "g" };
      })
      .filter((entry) => entry !== undefined)
      .slice(0, 100),
  };
}
