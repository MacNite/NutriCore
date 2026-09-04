/**
 * Reading USDA FoodData Central into NutriCore's model.
 *
 * Two very different callers share this module: the bundled import of the
 * Foundation and SR Legacy downloads, and the optional FoodData Central API
 * adapter. Both end up with the same `UsdaFoodRecord` shape, so the nutrient
 * map, the unit handling and the food-type reading exist once and are tested
 * once against the real downloads.
 *
 * FDC differs from BLS in every way that matters to an importer: it identifies
 * nutrients numerically, it states a unit per value rather than per column, it
 * omits a nutrient entirely when it was not determined (so absence really does
 * mean unknown), and it publishes portion weights.
 */
import type { ProviderFoodType } from "./types";
import { NUTRIENT_BY_KEY } from "@/lib/nutrients";
import { convertNutrientValue, isConvertible, tidyNutrientValue } from "@/lib/nutrient-units";
import { normalizeUnit } from "@/lib/units";
import type { DatasetDefinition, DatasetMapResult, ImportableFood, ImportableNutrient, ImportableServing } from "./types";

/** `[nutrientId, nutrientNumber, unitName, amount]`, as bundled. */
export type UsdaNutrientTuple = [number, string | null, string | null, number];

export interface UsdaPortion {
  amount: number | null;
  unit: string | null;
  abbreviation: string | null;
  modifier: string | null;
  gramWeight: number;
  sequence: number | null;
}

/** One line of `datasets/bundled/usda-*.ndjson.gz`. */
export interface UsdaFoodRecord {
  fdcId: number;
  dataType: string | null;
  description: string;
  category: string | null;
  ndbNumber: string | number | null;
  publicationDate: string | null;
  nutrients: UsdaNutrientTuple[];
  portions: UsdaPortion[];
  /** Only Branded foods carry these; generic FDC data types do not. */
  brand?: string | null;
  barcode?: string | null;
  servingSize?: number | null;
  servingSizeUnit?: string | null;
}

/**
 * One provider identity for every route into FoodData Central.
 *
 * A food imported from the SR Legacy download and the same food returned by
 * the API are the same FDC record, so they must reconcile onto one row rather
 * than become two. `Food.externalProvider`/`externalId` is unique, and using
 * `USDA_FDC` plus the FDC id for both is what makes that happen.
 */
export const USDA_PROVIDER = "USDA_FDC";

export const USDA_DATASETS: Record<string, DatasetDefinition> = {
  "usda-foundation": {
    key: "usda-foundation",
    provider: USDA_PROVIDER,
    sourceType: "USDA",
    url: (externalId) => `https://fdc.nal.usda.gov/food-details/${externalId}/nutrients`,
    confidence: 0.92,
  },
  "usda-sr-legacy": {
    key: "usda-sr-legacy",
    provider: USDA_PROVIDER,
    sourceType: "USDA",
    url: (externalId) => `https://fdc.nal.usda.gov/food-details/${externalId}/nutrients`,
    // SR Legacy was frozen in April 2018 and superseded by Foundation Foods,
    // so it is trusted slightly less than the current release.
    confidence: 0.88,
  },
};

/**
 * Canonical nutrient key -> the FDC nutrient ids that state it, best first,
 * each with the unit FDC publishes it in.
 *
 * Only ids observed in the bundled downloads (or, for the two sugar ids, in
 * FDC's documented Branded data) appear here. An id that has not been verified
 * against real data is left out rather than guessed at: a wrong id with a
 * plausible unit would store one nutrient's value under another's name, and
 * nothing downstream could detect it. That is why `chromium` has no USDA
 * entry - neither download reports it - while `iodine` (1100), `molybdenum`
 * (1097) and `biotin` (1176) do, each confirmed by its INFOODS tag number
 * (314, 311, 416) in the Foundation data.
 *
 * Where more than one id is listed the choice is a documented preference, and
 * the id that actually supplied the value is recorded on the nutrient row:
 *
 *  - `energyKcal` prefers 1008 (the standard energy value) over the Atwater
 *    variants 2047/2048, which only newer Foundation records carry.
 *  - `folate` prefers 1190 (dietary folate equivalents), which is what BLS's
 *    FOL and the D-A-CH reference values express, over 1177 (total folate).
 *  - `sugar` prefers 2000 (total sugars) over 1063 (sugars including NLEA).
 *
 * Not mapped: `omega3`/`omega6`, because FDC publishes the individual fatty
 * acids and no total - summing them would be a derivation, not the source's
 * number; and `salt`, which FDC does not report at all.
 */
export const USDA_NUTRIENT_MAP: Record<string, { id: number; unit: string }[]> = {
  energyKcal: [
    { id: 1008, unit: "kcal" },
    { id: 2047, unit: "kcal" },
    { id: 2048, unit: "kcal" },
  ],
  energyKj: [{ id: 1062, unit: "kJ" }],
  protein: [{ id: 1003, unit: "g" }],
  fat: [{ id: 1004, unit: "g" }],
  carbohydrate: [{ id: 1005, unit: "g" }],
  fiber: [{ id: 1079, unit: "g" }],
  sugar: [
    { id: 2000, unit: "g" },
    { id: 1063, unit: "g" },
  ],
  starch: [{ id: 1009, unit: "g" }],
  water: [{ id: 1051, unit: "g" }],
  alcohol: [{ id: 1018, unit: "g" }],
  saturatedFat: [{ id: 1258, unit: "g" }],
  monounsaturatedFat: [{ id: 1292, unit: "g" }],
  polyunsaturatedFat: [{ id: 1293, unit: "g" }],
  transFat: [{ id: 1257, unit: "g" }],
  cholesterol: [{ id: 1253, unit: "mg" }],
  sodium: [{ id: 1093, unit: "mg" }],
  potassium: [{ id: 1092, unit: "mg" }],
  calcium: [{ id: 1087, unit: "mg" }],
  magnesium: [{ id: 1090, unit: "mg" }],
  phosphorus: [{ id: 1091, unit: "mg" }],
  iron: [{ id: 1089, unit: "mg" }],
  zinc: [{ id: 1095, unit: "mg" }],
  copper: [{ id: 1098, unit: "mg" }],
  manganese: [{ id: 1101, unit: "mg" }],
  selenium: [{ id: 1103, unit: "µg" }],
  fluoride: [{ id: 1099, unit: "µg" }],
  iodine: [{ id: 1100, unit: "µg" }],
  molybdenum: [{ id: 1097, unit: "µg" }],
  vitaminA: [{ id: 1106, unit: "µg" }],
  vitaminD: [{ id: 1114, unit: "µg" }],
  vitaminE: [{ id: 1109, unit: "mg" }],
  vitaminK: [{ id: 1185, unit: "µg" }],
  thiamin: [{ id: 1165, unit: "mg" }],
  riboflavin: [{ id: 1166, unit: "mg" }],
  niacin: [{ id: 1167, unit: "mg" }],
  biotin: [{ id: 1176, unit: "µg" }],
  pantothenicAcid: [{ id: 1170, unit: "mg" }],
  vitaminB6: [{ id: 1175, unit: "mg" }],
  folate: [
    { id: 1190, unit: "µg" },
    { id: 1177, unit: "µg" },
  ],
  vitaminB12: [{ id: 1178, unit: "µg" }],
  vitaminC: [{ id: 1162, unit: "mg" }],
};

interface UsdaNutrientTarget {
  key: string;
  unit: string;
  /** Index in the preference list; a lower number wins. */
  rank: number;
}

const NUTRIENT_BY_ID: Map<number, UsdaNutrientTarget> = new Map();
for (const [key, candidates] of Object.entries(USDA_NUTRIENT_MAP)) {
  candidates.forEach((candidate, rank) => {
    NUTRIENT_BY_ID.set(candidate.id, { key, unit: candidate.unit, rank });
  });
}

/** Fails loudly if the map and the nutrient catalogue ever disagree. */
export function assertUsdaNutrientMap(): void {
  const problems: string[] = [];
  for (const [key, candidates] of Object.entries(USDA_NUTRIENT_MAP)) {
    const canonicalUnit = NUTRIENT_BY_KEY.get(key)?.unit;
    if (!canonicalUnit) {
      problems.push(`"${key}" is not in the nutrient catalogue`);
      continue;
    }
    for (const candidate of candidates) {
      if (!isConvertible(candidate.unit, canonicalUnit)) {
        problems.push(`nutrient ${candidate.id} (${key}): "${candidate.unit}" cannot be converted to "${canonicalUnit}"`);
      }
    }
  }
  if (problems.length > 0) throw new Error(`The USDA nutrient map is inconsistent:\n  - ${problems.join("\n  - ")}`);
}

const RAW_PATTERN = /(^|[\s,(])raw([\s,)]|$)/i;
const COOKED_PATTERN =
  /(cooked|boiled|roasted|baked|broiled|grilled|fried|braised|steamed|stewed|toasted|blanched|smoked|canned|prepared|heated)/i;

/**
 * FDC food category -> food type. The categories are the ones the bundled
 * downloads actually use; anything unrecognised falls back to GENERIC rather
 * than to a guess.
 */
const CATEGORY_FOOD_TYPE: Record<string, ProviderFoodType> = {
  Beverages: "BEVERAGE",
  "Alcoholic Beverages": "BEVERAGE",
  "Baked Products": "GENERIC",
  "Baby Foods": "GENERIC",
  "Beef Products": "RAW",
  "Breakfast Cereals": "GENERIC",
  "Cereal Grains and Pasta": "GENERIC",
  "Dairy and Egg Products": "GENERIC",
  "Fast Foods": "COOKED",
  "Fats and Oils": "GENERIC",
  "Finfish and Shellfish Products": "RAW",
  "Fruits and Fruit Juices": "RAW",
  "Lamb, Veal, and Game Products": "RAW",
  "Legumes and Legume Products": "RAW",
  "Meals, Entrees, and Side Dishes": "COOKED",
  "Nut and Seed Products": "GENERIC",
  "Pork Products": "RAW",
  "Poultry Products": "RAW",
  "Restaurant Foods": "COOKED",
  "Sausages and Luncheon Meats": "GENERIC",
  Snacks: "GENERIC",
  "Soups, Sauces, and Gravies": "COOKED",
  "Spices and Herbs": "GENERIC",
  Sweets: "GENERIC",
  "Vegetables and Vegetable Products": "RAW",
};

export function usdaRawState(description: string): string | null {
  if (RAW_PATTERN.test(description)) return "raw";
  if (COOKED_PATTERN.test(description)) return "cooked";
  return null;
}

export function usdaFoodType(record: Pick<UsdaFoodRecord, "category" | "description" | "dataType">): ProviderFoodType {
  if (record.dataType === "Branded") return "PACKAGED";
  const category = record.category ? CATEGORY_FOOD_TYPE[record.category] : undefined;
  const state = usdaRawState(record.description);
  if (category === "BEVERAGE") return "BEVERAGE";
  if (state === "raw") return "RAW";
  if (state === "cooked") return "COOKED";
  return category ?? "GENERIC";
}

/** The unit word a portion can be measured in, or null when it has none. */
function portionUnit(portion: UsdaPortion): { unit: string; label: string } | null {
  const named = [portion.abbreviation, portion.unit]
    .map((value) => value?.trim())
    .find((value) => value && value.toLowerCase() !== "undetermined");

  if (named) {
    return { unit: named, label: portion.modifier ? `${named} (${portion.modifier})` : named };
  }
  // SR Legacy leaves the measure unit "undetermined" and puts the real
  // measure in the modifier: "oz", "serving", "lb", "oz, boneless". The API's
  // search response does the same in `disseminationText`, but with the amount
  // in front of it - "1 cup, quartered or chopped" - so a leading quantity,
  // including a fraction, is stripped before the unit word is read.
  const modifier = portion.modifier?.trim();
  if (!modifier) return null;
  const withoutAmount = modifier.replace(/^[\d\s./]+/, "").trim();
  const word = /^[\p{L}]+/u.exec(withoutAmount)?.[0];
  if (!word) return null;
  return { unit: word, label: modifier };
}

/** At most this many named portions per food; FDC lists up to a dozen. */
const MAX_SERVINGS = 6;

export function usdaServings(portions: UsdaPortion[]): ImportableServing[] {
  const ordered = [...portions].sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));
  const servings: ImportableServing[] = [];
  const seen = new Set<string>();

  for (const portion of ordered) {
    if (!Number.isFinite(portion.gramWeight) || portion.gramWeight <= 0) continue;
    const named = portionUnit(portion);
    if (!named) continue;
    const key = normalizeUnit(named.unit);
    if (!key || seen.has(key)) continue;

    // A portion states the weight of `amount` of the unit; a serving row
    // states the weight of one, because that is what `resolvePortion`
    // multiplies by.
    const count = portion.amount && portion.amount > 0 ? portion.amount : 1;
    seen.add(key);
    servings.push({
      label: named.label,
      amount: 1,
      unit: named.unit,
      gramEquivalent: tidyNutrientValue(portion.gramWeight / count),
      mlEquivalent: null,
      isDefault: servings.length === 0,
    });
    if (servings.length >= MAX_SERVINGS) break;
  }
  return servings;
}

export function mapUsdaRecord(record: UsdaFoodRecord, unmapped?: Record<string, number>): ImportableFood | null {
  const name = record.description?.trim();
  if (!record.fdcId || !name) return null;

  const nutrients: Record<string, ImportableNutrient> = {};
  const chosenRank: Record<string, number> = {};

  for (const [id, number, unitName, amount] of record.nutrients) {
    const target = NUTRIENT_BY_ID.get(id);
    if (!target) {
      if (unmapped) {
        const label = `${id}${number ? `/${number}` : ""}`;
        unmapped[label] = (unmapped[label] ?? 0) + 1;
      }
      continue;
    }
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;

    // A better candidate for the same canonical key wins; an equal or worse one
    // is ignored so the choice cannot depend on the order of the array.
    const previous = chosenRank[target.key];
    if (previous !== undefined && previous <= target.rank) continue;

    // The unit FDC states must be the one the map was written for. When it is
    // not, the value is skipped and reported rather than converted on a guess.
    const stated = unitName?.trim() || target.unit;
    if (!isConvertible(stated, target.unit)) {
      if (unmapped) {
        const label = `${id}:unit=${stated}`;
        unmapped[label] = (unmapped[label] ?? 0) + 1;
      }
      continue;
    }

    const canonicalUnit = NUTRIENT_BY_KEY.get(target.key)?.unit ?? target.unit;
    chosenRank[target.key] = target.rank;
    nutrients[target.key] = {
      value: tidyNutrientValue(convertNutrientValue(amount, stated, canonicalUnit)),
      sourceValue: amount,
      sourceUnit: stated,
      // FDC omits a nutrient it did not determine, so a present value is
      // always a measured or derived number - never a placeholder.
      qualifier: null,
      origin: `FDC nutrient ${id}`,
    };
  }

  const servings = usdaServings(record.portions ?? []);

  return {
    externalId: String(record.fdcId),
    name,
    // FDC publishes English only. No name is machine-translated: a German user
    // reads the original English description, which is at least accurate.
    locale: "en",
    translations: [],
    aliases: [],
    foodType: usdaFoodType(record),
    rawState: usdaRawState(name),
    basisAmount: 100,
    basisUnit: "G",
    servings,
    nutrients,
    metadata: {
      fdcId: record.fdcId,
      ...(record.dataType ? { dataType: record.dataType } : {}),
      ...(record.category ? { category: record.category } : {}),
      ...(record.ndbNumber ? { ndbNumber: String(record.ndbNumber) } : {}),
      ...(record.publicationDate ? { publicationDate: record.publicationDate } : {}),
    },
  };
}

export function mapUsdaRecords(records: Iterable<UsdaFoodRecord>): DatasetMapResult {
  const foods: ImportableFood[] = [];
  const issues: DatasetMapResult["issues"] = [];
  const unmapped: Record<string, number> = {};

  for (const record of records) {
    const food = mapUsdaRecord(record, unmapped);
    if (!food) {
      issues.push({ externalId: String(record.fdcId ?? "(no id)"), detail: "record has no FDC id or no description" });
      continue;
    }
    if (Object.keys(food.nutrients).length === 0) {
      issues.push({ externalId: food.externalId, detail: "record carries no mappable nutrient value" });
      continue;
    }
    foods.push(food);
  }

  return { foods, issues, unmapped };
}
