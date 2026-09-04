/**
 * Reading the Bundeslebensmittelschlüssel 4.0 into NutriCore's model.
 *
 * BLS is the national German nutrient database, published by the Max
 * Rubner-Institut. It is the authoritative source for generic German foods,
 * and because it ships with the application it answers a search without a
 * network request at all.
 *
 * Three properties of the source shape everything here:
 *
 *  1. A value column is mixed-type. `11.45` is a measurement, `-` means the
 *     nutrient was never determined, `TR` means traces, `<LOD`/`<LOQ` mean
 *     below the detection or quantification limit. Reading the column as
 *     numbers - the obvious implementation - turns 110,083 unknown values into
 *     zeroes and misreports every food that has them.
 *  2. A zero is often real. Oats contain no alcohol, and BLS says so with a
 *     value of 0 tagged `Logische Null`. That must survive as a zero, because
 *     dropping it would send the food to the AI enrichment queue for a value
 *     that is already known exactly.
 *  3. The units are BLS's own. Copper and manganese are µg, sodium is mg,
 *     vitamin B6 is µg - all three differ from what NutriCore stores.
 */
import type { Locale } from "@prisma/client";
import { NUTRIENT_BY_KEY } from "@/lib/nutrients";
import { convertNutrientValue, isConvertible, tidyNutrientValue } from "@/lib/nutrient-units";
import type {
  DatasetDefinition,
  DatasetMapResult,
  ImportableFood,
  ImportableNutrient,
  NutrientQualifier,
  ProviderFoodType,
} from "./types";

/** One line of `datasets/bundled/bls-4.0.ndjson.gz`. */
export interface BlsRecord {
  code: string;
  nameDe: string;
  nameEn: string;
  note: string | null;
  /** Component code -> [value, data-source category]. */
  values: Record<string, [number | string, string | null]>;
}

export interface BlsComponent {
  code: string;
  nameDe: string;
  nameEn: string;
  unit: string;
  groupDe: string;
  groupEn: string;
  formula: string | null;
}

export const BLS_DATASET: DatasetDefinition = {
  key: "bls",
  provider: "BLS",
  sourceType: "BLS",
  // BLS publishes no per-food page, so the food's own identifier is all the
  // attribution there is; the dataset itself is linked from About.
  url: () => "https://blsdb.de/",
  confidence: 0.95,
};

/**
 * BLS component code -> canonical nutrient key, with the unit BLS publishes it
 * in. The unit is stated here rather than read from the component file so that
 * a future BLS release which changes one fails the import loudly instead of
 * writing a value that is wrong by a factor of a thousand.
 *
 * Exactly one component per canonical key. Where BLS offers a choice the
 * decision is recorded rather than left to a fallback:
 *
 *  - `protein` is PROT625 (N × 6.25), the value BLS itself calls protein.
 *  - `vitaminA` is VITA (retinol equivalents), which is what EU nutrition
 *    labelling and the D-A-CH reference values use, not VITAA (RAE).
 *  - `niacin` is NIA (niacin as such), not NIAEQ, which counts protein-bound
 *    tryptophan and is not comparable with what other sources report.
 *  - `folate` is FOL (folate equivalents, present for 7,136 of 7,140 foods),
 *    the basis of the D-A-CH intake reference, not FOLFD (native folate).
 *  - `vitaminE` is VITE, which BLS defines as alpha-tocopherol exactly.
 *
 * Not mapped, deliberately: `selenium` and `transFat`, because BLS 4.0
 * publishes neither, and the 93 remaining components - the amino acids, the
 * individual fatty acids, the fibre and carbohydrate fractions, the organic
 * acids and the tocopherol spectrum - which no canonical key claims.
 */
export const BLS_COMPONENT_MAP: Record<string, { key: string; unit: string }> = {
  ENERCC: { key: "energyKcal", unit: "kcal" },
  ENERCJ: { key: "energyKj", unit: "kJ" },
  PROT625: { key: "protein", unit: "g" },
  FAT: { key: "fat", unit: "g" },
  CHO: { key: "carbohydrate", unit: "g" },
  FIBT: { key: "fiber", unit: "g" },
  SUGAR: { key: "sugar", unit: "g" },
  STARCH: { key: "starch", unit: "g" },
  POLYL: { key: "polyols", unit: "g" },
  WATER: { key: "water", unit: "g" },
  ALC: { key: "alcohol", unit: "g" },
  FASAT: { key: "saturatedFat", unit: "g" },
  FAMS: { key: "monounsaturatedFat", unit: "g" },
  FAPU: { key: "polyunsaturatedFat", unit: "g" },
  FAPUN3: { key: "omega3", unit: "g" },
  FAPUN6: { key: "omega6", unit: "g" },
  CHORL: { key: "cholesterol", unit: "mg" },
  NACL: { key: "salt", unit: "g" },
  NA: { key: "sodium", unit: "mg" },
  K: { key: "potassium", unit: "mg" },
  CA: { key: "calcium", unit: "mg" },
  MG: { key: "magnesium", unit: "mg" },
  P: { key: "phosphorus", unit: "mg" },
  CLD: { key: "chloride", unit: "mg" },
  FE: { key: "iron", unit: "mg" },
  ZN: { key: "zinc", unit: "mg" },
  CU: { key: "copper", unit: "µg" },
  MN: { key: "manganese", unit: "µg" },
  ID: { key: "iodine", unit: "µg" },
  FD: { key: "fluoride", unit: "µg" },
  CR: { key: "chromium", unit: "µg" },
  MO: { key: "molybdenum", unit: "µg" },
  VITA: { key: "vitaminA", unit: "µg" },
  VITD: { key: "vitaminD", unit: "µg" },
  VITE: { key: "vitaminE", unit: "mg" },
  VITK: { key: "vitaminK", unit: "µg" },
  THIA: { key: "thiamin", unit: "mg" },
  RIBF: { key: "riboflavin", unit: "mg" },
  NIA: { key: "niacin", unit: "mg" },
  PANTAC: { key: "pantothenicAcid", unit: "mg" },
  VITB6: { key: "vitaminB6", unit: "µg" },
  BIOT: { key: "biotin", unit: "µg" },
  FOL: { key: "folate", unit: "µg" },
  VITB12: { key: "vitaminB12", unit: "µg" },
  VITC: { key: "vitaminC", unit: "mg" },
};

/** BLS's own vocabulary for a value that is present but not quantified. */
const QUALIFIER_TOKENS: Record<string, NutrientQualifier> = {
  TR: "TRACE",
  "<LOD": "BELOW_LOD",
  "<LOQ": "BELOW_LOQ",
  "<LOD or <LOQ": "BELOW_LOD_OR_LOQ",
  "<LOQ or <LOD": "BELOW_LOD_OR_LOQ",
};

/** The token BLS writes when a nutrient was never determined for a food. */
const UNKNOWN_TOKEN = "-";

/** A zero BLS states as a fact about the food rather than as a measurement. */
const LOGICAL_ZERO_ORIGIN = "Logische Null";

/**
 * The leading letter of a BLS code names the main food group. The letters are
 * read off the dataset itself - the reference manual documents the `1 letter +
 * 6 digits` structure and gives one example - so this is NutriCore's reading
 * of the group, not an official BLS label, and it is only ever used to pick a
 * FoodType. The name-based refinement below has the final say.
 */
const GROUP_FOOD_TYPE: Record<string, ProviderFoodType> = {
  B: "GENERIC", // bread
  C: "GENERIC", // cereals and cereal products
  D: "GENERIC", // baked goods, biscuits
  E: "GENERIC", // pasta
  F: "RAW", // fruit
  G: "RAW", // vegetables
  H: "RAW", // legumes, sprouts
  K: "RAW", // potatoes, starches
  M: "GENERIC", // milk and dairy
  N: "BEVERAGE", // non-alcoholic drinks, coffee, tea
  P: "BEVERAGE", // alcoholic drinks
  Q: "GENERIC", // oils and fats
  R: "GENERIC", // spices, salt, condiments
  S: "GENERIC", // sugar, honey, confectionery
  T: "RAW", // fish and seafood
  U: "RAW", // meat
  V: "RAW", // game and poultry
  W: "GENERIC", // sausage and cured meat
  X: "COOKED", // soups, stocks, menu components
  Y: "COOKED", // prepared dishes
};

const RAW_PATTERN = /(^|[\s,(/])roh([\s,)/]|$)/i;
const COOKED_PATTERN =
  /(gekocht|gegart|gebraten|gegrillt|gebacken|frittiert|gedünstet|gedämpft|blanchiert|geräuchert|gepökelt|gebrüht|erhitzt|zubereitet)/i;

/** `raw`/`cooked` as the rest of NutriCore spells it, or nothing. */
export function blsRawState(nameDe: string): string | null {
  if (RAW_PATTERN.test(nameDe)) return "raw";
  if (COOKED_PATTERN.test(nameDe)) return "cooked";
  return null;
}

export function blsFoodType(code: string, nameDe: string): ProviderFoodType {
  const group = GROUP_FOOD_TYPE[code.charAt(0).toUpperCase()];
  const state = blsRawState(nameDe);
  // A drink stays a drink however it was made; otherwise the preparation in
  // the name is more specific than the group it belongs to.
  if (group === "BEVERAGE") return "BEVERAGE";
  if (state === "raw") return "RAW";
  if (state === "cooked") return "COOKED";
  return group ?? "GENERIC";
}

/**
 * Splits the slash-separated synonyms BLS packs into a single name.
 *
 * "Speisesalz/Siedesalz/Tafelsalz" is three names for one food and
 * "Stielmus/Rübstiel, roh" is two, but a search for "Tafelsalz" or "Rübstiel"
 * matches neither as stored, because the substring never begins a word the
 * user would type. The qualifying tail is kept on every variant, so
 * "Salzbrezeln/Salzstangen (Laugendauergebäck)" yields two complete names
 * rather than one bare word.
 *
 * BLS supplies no synonym list of its own, so this is the only alias source
 * the dataset actually offers.
 */
export function splitNameVariants(name: string): string[] {
  const match = /^([^,(]*)([,(].*)?$/.exec(name);
  if (!match) return [];
  const head = match[1] ?? "";
  const tail = match[2] ?? "";
  if (!head.includes("/")) return [];

  const parts = head
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && /\p{L}/u.test(part));
  // Two to five synonyms is what the dataset actually contains; more than that
  // is a name the split has misread, so it is left alone.
  if (parts.length < 2 || parts.length > 5) return [];

  const suffix = tail.trim();
  const variants = parts.map((part) => (suffix.startsWith("(") ? `${part} ${suffix}` : `${part}${suffix}`).trim());
  return variants.filter((variant) => variant !== name);
}

interface ParsedValue {
  known: boolean;
  value: number | null;
  qualifier: NutrientQualifier | null;
  unexpected?: string;
}

/** Reads one BLS cell. See the module comment for why this is not `Number()`. */
export function parseBlsValue(raw: number | string, origin: string | null): ParsedValue {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { known: false, value: null, qualifier: null };
    return {
      known: true,
      value: raw,
      qualifier: origin === LOGICAL_ZERO_ORIGIN && raw === 0 ? "LOGICAL_ZERO" : null,
    };
  }

  const token = raw.trim();
  if (token === "" || token === UNKNOWN_TOKEN) return { known: false, value: null, qualifier: null };

  const qualifier = QUALIFIER_TOKENS[token];
  // Present but unquantified: the value stays unknown - a trace is emphatically
  // not zero - while the qualifier records that the food does contain it.
  if (qualifier) return { known: true, value: null, qualifier };

  // A number that arrived as text (a locale-formatted cell, say). Accepted, but
  // only when it is unambiguously numeric.
  const numeric = Number(token.replace(",", "."));
  if (/^-?\d+([.,]\d+)?$/.test(token) && Number.isFinite(numeric)) {
    return { known: true, value: numeric, qualifier: null };
  }

  return { known: false, value: null, qualifier: null, unexpected: token };
}

/**
 * Fails the import when a BLS release changes a component's unit.
 *
 * The alternative - trusting the unit in the component file - would convert
 * correctly but silently change every stored value the next time BLS switches
 * copper from µg to mg. Better to stop and have somebody update the map.
 */
export function assertBlsComponentUnits(components: BlsComponent[]): void {
  const byCode = new Map(components.map((component) => [component.code, component]));
  const problems: string[] = [];

  for (const [code, mapping] of Object.entries(BLS_COMPONENT_MAP)) {
    const component = byCode.get(code);
    if (!component) {
      problems.push(`component ${code} (-> ${mapping.key}) is missing from the dataset`);
      continue;
    }
    if (component.unit !== mapping.unit) {
      problems.push(`component ${code} is published in "${component.unit}", the map expects "${mapping.unit}"`);
    }
    const canonicalUnit = NUTRIENT_BY_KEY.get(mapping.key)?.unit;
    if (!canonicalUnit) {
      problems.push(`component ${code} maps to unknown nutrient "${mapping.key}"`);
    } else if (!isConvertible(mapping.unit, canonicalUnit)) {
      problems.push(`component ${code}: "${mapping.unit}" cannot be converted to "${canonicalUnit}"`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`The bundled BLS dataset does not match the component map:\n  - ${problems.join("\n  - ")}`);
  }
}

const DE: Locale = "de";
const EN: Locale = "en";

/** Maps one BLS record. Returns null only for a record with no usable name. */
export function mapBlsRecord(record: BlsRecord, unmapped?: Record<string, number>): ImportableFood | null {
  const nameDe = record.nameDe?.trim();
  if (!record.code || !nameDe) return null;
  const nameEn = record.nameEn?.trim();

  const nutrients: Record<string, ImportableNutrient> = {};
  for (const [code, entry] of Object.entries(record.values)) {
    const mapping = BLS_COMPONENT_MAP[code];
    if (!mapping) {
      if (unmapped) unmapped[code] = (unmapped[code] ?? 0) + 1;
      continue;
    }
    const [raw, origin] = entry;
    const parsed = parseBlsValue(raw, origin);
    if (parsed.unexpected && unmapped) {
      unmapped[`${code}:${parsed.unexpected}`] = (unmapped[`${code}:${parsed.unexpected}`] ?? 0) + 1;
    }
    if (!parsed.known) continue;

    const canonicalUnit = NUTRIENT_BY_KEY.get(mapping.key)?.unit ?? mapping.unit;
    nutrients[mapping.key] = {
      value:
        parsed.value === null ? null : tidyNutrientValue(convertNutrientValue(parsed.value, mapping.unit, canonicalUnit)),
      // The source's own number and unit, so the conversion stays auditable
      // and no precision is lost to it.
      sourceValue: parsed.value,
      sourceUnit: mapping.unit,
      qualifier: parsed.qualifier,
      origin,
    };
  }

  const aliases = [
    ...splitNameVariants(nameDe).map((name) => ({ locale: DE, name })),
    ...(nameEn ? splitNameVariants(nameEn).map((name) => ({ locale: EN, name })) : []),
  ];

  return {
    externalId: record.code,
    name: nameDe,
    locale: DE,
    // BLS publishes an official English name for every food, so an
    // English-speaking user reads English rather than German.
    translations: nameEn && nameEn !== nameDe ? [{ locale: EN, name: nameEn }] : [],
    aliases,
    foodType: blsFoodType(record.code, nameDe),
    rawState: blsRawState(nameDe),
    // Every BLS value is per 100 g of the edible portion. The dataset states no
    // portion weights and no densities, so none are invented here.
    basisAmount: 100,
    basisUnit: "G",
    servings: [],
    nutrients,
    metadata: {
      blsCode: record.code,
      blsGroup: record.code.charAt(0).toUpperCase(),
      nameDe,
      ...(nameEn ? { nameEn } : {}),
      ...(record.note ? { note: record.note } : {}),
    },
  };
}

export function mapBlsRecords(records: Iterable<BlsRecord>): DatasetMapResult {
  const foods: ImportableFood[] = [];
  const issues: DatasetMapResult["issues"] = [];
  const unmapped: Record<string, number> = {};

  for (const record of records) {
    const food = mapBlsRecord(record, unmapped);
    if (!food) {
      issues.push({ externalId: record.code ?? "(no code)", detail: "record has no BLS code or no German name" });
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
