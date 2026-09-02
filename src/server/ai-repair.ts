/**
 * Repairs a decoded model answer before it is validated.
 *
 * Ollama constrains generation with a grammar derived from the JSON schema, and
 * that grammar enforces *shape only*: llama.cpp ignores numeric ranges, string
 * lengths and array bounds. So a model that does not know a weight writes `0`,
 * which `z.number().positive()` then rejects - discarding the entire meal over
 * one unknown value, even though `decideComponents` already skips a component
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
  const quantity = positiveOrAbsent(value.quantity, 10000);
  const repairedUnit = repairMealUnit(value.unit, quantity);
  return compact({
    name,
    quantity,
    unit: repairedUnit.unit,
    // A proper JSON field always wins. The fallback only recovers a common
    // small-model response such as `unit: "Scheiben (approx. 50g)"`.
    estimatedGrams: positiveOrAbsent(value.estimatedGrams, 10000) ?? repairedUnit.estimatedGrams,
    preparation: textOrAbsent(value.preparation, 80),
    // Dropped whole unless all four macronutrients are present: a partial block
    // would either fail validation or, filled with zeroes, understate the meal.
    nutritionPer100g: isRecord(value.nutritionPer100g) ? repairModelNutrition(value.nutritionPer100g) : undefined,
  });
}

/**
 * Pulls a per-item gram estimate out of a unit when a small model put it there.
 *
 * `estimatedGrams` is the total component weight, while text appended to a unit
 * describes one of those units. Consequently "2 Scheiben (ca. 50 g)" becomes
 * unit "Scheiben" and 100 estimated grams. This is a syntactic recovery of a
 * number the model already supplied, not a new portion guess made by the code.
 */
function repairMealUnit(
  value: unknown,
  quantity: number | undefined,
): { unit?: string; estimatedGrams?: number } {
  const unit = textOrAbsent(value, 30);
  if (!unit) return {};

  const embedded = unit.match(/\s*[([]\s*(?:(?:ca|approx|approximately)\.?\s*)?(\d+(?:[.,]\d+)?)\s*g(?:ramm?)?\s*[)\]]\s*$/i);
  if (!embedded) return { unit };

  const gramsEach = positiveOrAbsent(embedded[1], 10000);
  const cleanUnit = textOrAbsent(unit.slice(0, embedded.index).trim(), 30);
  const estimatedGrams = gramsEach && quantity ? positiveOrAbsent(gramsEach * quantity, 10000) : gramsEach;
  return compact({ unit: cleanUnit, estimatedGrams });
}

export function repairMealParse(value: unknown): unknown {
  if (!isRecord(value)) return value;
  // The dish name is optional, so one the model did not give - or gave as an
  // empty string - stays absent and the caller falls back to the typed text.
  return compact({
    name: textOrAbsent(value.name, 200),
    components: asArray(value.components)
      .map(repairComponent)
      .filter((component) => component !== undefined)
      .slice(0, 40),
    confidence: confidenceBand(value.confidence),
    warnings: stringList(value.warnings, 10, 200),
  });
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
      // These are raw source values, not normalized values. Keep finite values
      // for the deterministic plausibility gate to assess after normalization.
      const repaired = nonNegativeOrAbsent(raw, 1_000_000);
      if (repaired !== undefined) nutrients[key] = repaired;
    }
    const basisUnit = value.basisUnit === "g" || value.basisUnit === "serving" || value.basisUnit === "ml" ? value.basisUnit : undefined;
    return compact({
      nutrients,
      basisAmount: positiveOrAbsent(value.basisAmount, 100_000),
      basisUnit,
      servingSizeG: positiveOrAbsent(value.servingSizeG, 100_000),
    });
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

/** The first of `keys` that holds usable text. */
function firstText(value: Record<string, unknown>, keys: readonly string[], max: number) {
  for (const key of keys) {
    const text = textOrAbsent(value[key], max);
    if (text) return text;
  }
  return undefined;
}

const FRACTION_GLYPHS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

/**
 * Reads a quantity written at the start of a line: "500", "1,5", "1 1/2", "3/4",
 * "½" and the lower bound of a range such as "2-3". Returns what is left of
 * the line with it, so the caller can go on to read the unit and the name.
 */
function leadingQuantity(text: string): { amount: number; rest: string } | undefined {
  const trimmed = text.trimStart();
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*/);
  if (mixed) return { amount: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]), rest: trimmed.slice(mixed[0].length) };
  const fraction = trimmed.match(/^(\d+)\s*\/\s*(\d+)\s*/);
  if (fraction) return { amount: Number(fraction[1]) / Number(fraction[2]), rest: trimmed.slice(fraction[0].length) };
  const glyph = trimmed.match(/^([½¼¾⅓⅔⅛])\s*/);
  if (glyph) return { amount: FRACTION_GLYPHS[glyph[1]], rest: trimmed.slice(glyph[0].length) };
  // A range is read at its lower bound: that is a quantity the source stated,
  // where the midpoint would be a number nobody wrote down.
  const decimal = trimmed.match(/^(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*/);
  if (decimal) return { amount: Number(decimal[1].replace(",", ".")), rest: trimmed.slice(decimal[0].length) };
  return undefined;
}

/** Measure words a recipe line may put between its quantity and its ingredient. */
const UNIT_WORDS = new Set([
  "g", "gr", "gram", "grams", "gramm", "kg", "mg", "ml", "milliliter", "millilitre", "l", "liter", "litre", "cl", "dl",
  "el", "tl", "esslöffel", "teelöffel", "msp", "prise", "prisen", "tbsp", "tsp", "cup", "cups", "tasse", "tassen",
  "stück", "stueck", "stk", "scheibe", "scheiben", "slice", "slices", "bund", "zehe", "zehen", "clove", "cloves",
  "dose", "dosen", "can", "cans", "packung", "packungen", "päckchen", "paeckchen", "pack", "becher", "glas", "gläser",
  "kugel", "blatt", "blätter", "tropfen", "handvoll", "portion", "portionen", "piece", "pieces", "oz", "lb", "pound", "ounce",
]);

const cleanWord = (word: string) => word.replace(/[.,;:]+$/, "");

/**
 * Units that count containers rather than measure anything, plus the bare count
 * a line with no measure word gets. A weight stated beside one of these is the
 * only weight the line carries.
 */
const PACKAGE_WORDS = new Set([
  "piece", "dose", "dosen", "can", "cans", "packung", "packungen", "päckchen", "paeckchen", "pack",
  "becher", "glas", "gläser", "tüte", "tuete", "beutel", "bund", "tafel", "tafeln",
]);

/**
 * Pulls the weight a package line states beside its contents.
 *
 * "1 Dose gehackte Tomaten (400 g)" carries the only usable quantity in that
 * bracket: the can itself has no weight this code may invent, so the line used
 * to be reported as unconvertible while the source had said 400 g all along.
 * The count multiplies it, because two cans of 400 g are 800 g - the same
 * reading `repairMealUnit` already makes of "2 Scheiben (ca. 50 g)".
 */
function weightBesideName(
  name: string,
  unit: string,
  count: number,
): { name: string; amount: number; unit: string } | undefined {
  if (!PACKAGE_WORDS.has(cleanWord(unit).toLowerCase())) return undefined;
  const match = name.match(/\s*[([]\s*(?:(?:ca|approx|approximately|je|each)\.?\s*)?(\d+(?:[.,]\d+)?)\s*(g|gramm?|kg|ml|l)\b\s*[)\]]\s*$/i);
  if (!match) return undefined;
  const each = positiveOrAbsent(match[1], 100_000);
  const stripped = textOrAbsent(name.slice(0, match.index).trim(), 120);
  const amount = each === undefined ? undefined : positiveOrAbsent(each * count, 100_000);
  if (amount === undefined || !stripped) return undefined;
  return { name: stripped, amount, unit: match[2].toLowerCase() };
}

/**
 * Recovers an ingredient from one line of text - "200 g Mehl", "2 Eier",
 * "½ TL Salz".
 *
 * A model answering in plain JSON mode routinely returns the ingredient list as
 * strings, or puts the whole line in `name` and no amount anywhere, and every
 * one of those entries used to be dropped - leaving an empty array that failed
 * validation and lost the entire recipe. This reads the quantity the source
 * already stated; it does not estimate one, so a line without a number is still
 * dropped.
 */
export function ingredientFromText(value: unknown): { name: string; amount: number; unit: string } | undefined {
  const text = textOrAbsent(value, 300);
  if (!text) return undefined;
  const quantity = leadingQuantity(text);
  if (!quantity) return undefined;
  const amount = positiveOrAbsent(quantity.amount, 100_000);
  if (amount === undefined) return undefined;

  const [first = "", ...rest] = quantity.rest.split(/\s+/);
  const measured = UNIT_WORDS.has(cleanWord(first).toLowerCase());
  const name = textOrAbsent((measured ? rest.join(" ") : quantity.rest).replace(/^[\s,;:.-]+/, ""), 120);
  if (!name) return undefined;
  // A counted ingredient keeps a counting unit rather than the gram default: "2
  // Eier" is two eggs, and calling it two grams would be an invented weight.
  const unit = measured ? cleanWord(first).slice(0, 40) : "piece";
  return weightBesideName(name, unit, amount) ?? { name, amount, unit };
}

const NAME_KEYS = ["name", "ingredient", "item", "zutat", "food", "title"] as const;
const AMOUNT_KEYS = ["amount", "quantity", "menge", "qty", "value"] as const;
const UNIT_KEYS = ["unit", "units", "einheit", "measure", "unitOfMeasure", "unit_of_measure"] as const;

/**
 * One ingredient in whatever shape the model chose, as the schema needs it.
 * Only the model's own words are read: nothing here supplies a quantity the
 * source did not state.
 */
function repairRecipeIngredient(entry: unknown) {
  if (typeof entry === "string") return ingredientFromText(entry);
  if (!isRecord(entry)) return undefined;

  const named = firstText(entry, NAME_KEYS, 300);
  const rawAmount = AMOUNT_KEYS.map((key) => entry[key]).find((candidate) => candidate !== undefined && candidate !== null);
  const unit = firstText(entry, UNIT_KEYS, 40);
  // "200 g" written into the amount field carries the unit with it.
  const written = typeof rawAmount === "string" ? leadingQuantity(rawAmount) : undefined;
  const amount = positiveOrAbsent(rawAmount, 100_000) ?? (written ? positiveOrAbsent(written.amount, 100_000) : undefined);

  if (named && amount !== undefined) {
    const fromAmountField = textOrAbsent(written?.rest, 40);
    return { name: named.slice(0, 120), amount, unit: unit ?? fromAmountField ?? "g" };
  }
  // No usable amount field: the model wrote the whole line into the name.
  if (named) {
    const parsed = ingredientFromText(named);
    if (parsed) return unit ? { ...parsed, unit } : parsed;
  }
  return undefined;
}

/** Ingredients as a list, however the model spelt the key or shaped the value. */
function ingredientEntries(value: Record<string, unknown>): unknown[] {
  for (const key of ["ingredients", "zutaten", "ingredientList", "ingredient_list", "recipeIngredient"]) {
    const candidate = value[key];
    if (Array.isArray(candidate) && candidate.length) return candidate;
    // `{"Mehl": "200 g"}` instead of a list; the key is the name.
    if (isRecord(candidate)) return Object.entries(candidate).map(([name, amount]) => ({ name, amount }));
  }
  return asArray(value.ingredients);
}

/** Repairs an imported recipe as `extractedRecipeSchema` expects it. */
export function repairExtractedRecipe(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    name: textOrEmpty(value.name, 200) || "Unbenanntes Rezept",
    description: textOrEmpty(value.description, 2000),
    servings: positiveOrAbsent(value.servings, 10_000) ?? 1,
    instructions: textOrEmpty(value.instructions, 20_000),
    ingredients: ingredientEntries(value)
      .map(repairRecipeIngredient)
      .filter((entry) => entry !== undefined)
      .slice(0, 100),
  };
}
