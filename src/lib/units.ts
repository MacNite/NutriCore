export type BasisUnit = "G" | "ML";

export interface ServingDefinition {
  label: string;
  amount: number;
  unit: string;
  gramEquivalent?: number | null;
  mlEquivalent?: number | null;
}

export interface PortionContext {
  basisUnit: BasisUnit;
  /** Grams per millilitre. Required for any mass <-> volume conversion. */
  densityGPerMl?: number | null;
  servings?: ServingDefinition[];
}

export type PortionResult =
  | { ok: true; amount: number; unit: BasisUnit }
  | { ok: false; reason: "unknown-unit" | "density-required" | "invalid-amount" | "unknown-serving" };

const MASS_TO_G: Record<string, number> = { g: 1, gram: 1, gramm: 1, kg: 1000, mg: 0.001 };
const VOLUME_TO_ML: Record<string, number> = { ml: 1, milliliter: 1, millilitre: 1, l: 1000, liter: 1000, litre: 1000, cl: 10, dl: 100 };

export const normalizeUnit = (unit: string) => unit.trim().toLowerCase().replace(/\.$/, "");

/**
 * Spellings that all name "one of them", in either language.
 *
 * A counted line - "2 Eier" - carries no measure word, so the parser calls the
 * unit `piece`; the food it belongs to defines its portion as `Stück`. Matching
 * those by string alone failed every counted German ingredient, and the weight
 * the food itself states was reported as unusable.
 */
const PIECE_WORDS = new Set(["piece", "pieces", "stück", "stücke", "stueck", "stk", "st", "pc", "pcs", "item", "items"]);

/** True when two already-normalised unit spellings name the same portion. */
const sameUnitWord = (a: string, b: string) => a === b || (PIECE_WORDS.has(a) && PIECE_WORDS.has(b));

/** The serving a unit refers to, matched on the food's own label or unit. */
function matchServing(unit: string, servings: ServingDefinition[] | undefined) {
  const key = normalizeUnit(unit);
  return servings?.find((s) => sameUnitWord(normalizeUnit(s.label), key) || sameUnitWord(normalizeUnit(s.unit), key));
}

/**
 * The food's own spelling of a named portion, for a unit that means the same
 * thing. Storing `piece` where the food says `Stück` would leave the recipe
 * form with a value its own dropdown does not offer.
 */
export function servingLabelFor(unit: string, context: PortionContext): string | null {
  return matchServing(unit, context.servings)?.label ?? null;
}

/**
 * Resolves a user-entered quantity to the food's canonical basis unit.
 *
 * Volume and mass are only ever converted through an explicitly stored density.
 * Without one the conversion fails loudly rather than assuming 1 ml = 1 g.
 */
export function resolvePortion(amount: number, unit: string, context: PortionContext): PortionResult {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: "invalid-amount" };

  const key = normalizeUnit(unit);
  const density = context.densityGPerMl ?? null;

  if (key in MASS_TO_G) {
    const grams = amount * MASS_TO_G[key];
    if (context.basisUnit === "G") return { ok: true, amount: grams, unit: "G" };
    if (!density || density <= 0) return { ok: false, reason: "density-required" };
    return { ok: true, amount: grams / density, unit: "ML" };
  }

  if (key in VOLUME_TO_ML) {
    const ml = amount * VOLUME_TO_ML[key];
    if (context.basisUnit === "ML") return { ok: true, amount: ml, unit: "ML" };
    if (!density || density <= 0) return { ok: false, reason: "density-required" };
    return { ok: true, amount: ml * density, unit: "G" };
  }

  // Named portions ("piece", "slice", "Scheibe", ...) must carry a resolved
  // gram or millilitre quantity; they are never guessed.
  const serving = matchServing(unit, context.servings);
  if (!serving) return { ok: false, reason: "unknown-unit" };

  const perServingG = serving.gramEquivalent ?? null;
  const perServingMl = serving.mlEquivalent ?? null;

  if (context.basisUnit === "G") {
    if (perServingG != null) return { ok: true, amount: amount * perServingG, unit: "G" };
    if (perServingMl != null && density && density > 0) {
      return { ok: true, amount: amount * perServingMl * density, unit: "G" };
    }
    return { ok: false, reason: perServingMl != null ? "density-required" : "unknown-serving" };
  }

  if (perServingMl != null) return { ok: true, amount: amount * perServingMl, unit: "ML" };
  if (perServingG != null && density && density > 0) {
    return { ok: true, amount: (amount * perServingG) / density, unit: "ML" };
  }
  return { ok: false, reason: perServingG != null ? "density-required" : "unknown-serving" };
}

/**
 * A resolved portion plus the weight in grams a recipe ingredient needs.
 *
 * Recipe totals, the per-100 g values and the portion weight are all derived
 * from grams, so resolving to millilitres is only half an answer: turning those
 * into a weight needs the food's density, and without one the ingredient cannot
 * be used at all. That is the same refusal to assume 1 ml = 1 g that
 * `resolvePortion` makes - stated here once, so the recipe save, the AI import
 * and the form's unit list cannot disagree about which units are usable.
 */
export type IngredientWeightResult =
  | { ok: true; amount: number; unit: BasisUnit; weightG: number }
  | Extract<PortionResult, { ok: false }>;

export function resolveIngredientWeight(amount: number, unit: string, context: PortionContext): IngredientWeightResult {
  const portion = resolvePortion(amount, unit, context);
  if (!portion.ok) return portion;
  if (portion.unit === "G") return { ...portion, weightG: portion.amount };
  const density = context.densityGPerMl ?? 0;
  if (density > 0) return { ...portion, weightG: portion.amount * density };
  return { ok: false, reason: "density-required" };
}

/**
 * Spellings of the metric units, mapped to the one `resolvePortion` knows.
 *
 * A model asked for a recipe answers in the source's words - "Gramm", "grams",
 * "Milliliter" - and every one of those used to reach `resolvePortion` as an
 * unknown unit, which failed the save with nothing the reader could act on.
 * Only spellings of the same unit are listed: nothing here converts between
 * units, and a measure word like "EL" has no metric meaning to map to.
 */
const UNIT_ALIASES: Record<string, string> = {
  g: "g", gr: "g", gram: "g", grams: "g", gramm: "g", gramme: "g", gramms: "g",
  kg: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilogramm: "kg", kilograms: "kg",
  mg: "mg", milligram: "mg", milligramm: "mg",
  ml: "ml", milliliter: "ml", millilitre: "ml", milliliters: "ml", millilitres: "ml",
  l: "l", liter: "l", litre: "l", liters: "l", litres: "l",
  cl: "cl", centiliter: "cl", centilitre: "cl",
  dl: "dl", deciliter: "dl", decilitre: "dl",
};

/** The metric unit this spelling means, or nothing when it is not metric. */
export const canonicalUnit = (unit: string): string | null => UNIT_ALIASES[normalizeUnit(unit)] ?? null;

const MASS_UNITS = ["g", "kg", "mg"];
const VOLUME_UNITS = ["ml", "l", "dl", "cl"];

/**
 * Every unit this food can actually be measured in, most natural first.
 *
 * Derived by asking `resolvePortion` itself, so the list can never offer a unit
 * the save would then reject: a food with no density drops the other family,
 * and a named portion appears only when the food defines its weight. This is
 * what the recipe form's unit dropdown is built from.
 */
export function allowedUnits(context: PortionContext): string[] {
  const metric = context.basisUnit === "ML" ? [...VOLUME_UNITS, ...MASS_UNITS] : [...MASS_UNITS, ...VOLUME_UNITS];
  const named = (context.servings ?? []).flatMap((serving) => [serving.label, serving.unit]);
  const seen = new Set<string>();
  return [...metric, ...named].filter((unit) => {
    const key = normalizeUnit(unit ?? "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return resolveIngredientWeight(1, unit, context).ok;
  });
}

/**
 * Parses an Open Food Facts `serving_size` string such as "30 g", "1 Scheibe (25g)"
 * or "250ml" into an explicit amount and unit. Returns null when unparseable
 * rather than inventing a portion.
 */
export function parseServingSize(raw: string | null | undefined): { amount: number; unit: string } | null {
  if (!raw) return null;
  const text = raw.replace(",", ".").toLowerCase();
  // Prefer a parenthesised metric quantity: "1 Scheibe (25 g)" -> 25 g.
  const parenthesised = text.match(/\(\s*([\d.]+)\s*(kg|mg|g|ml|cl|dl|l)\b/);
  const direct = text.match(/([\d.]+)\s*(kg|mg|g|ml|cl|dl|l)\b/);
  const match = parenthesised ?? direct;
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit: match[2] };
}

/** Case/whitespace/punctuation normalisation that keeps brand distinctions intact. */
export function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
