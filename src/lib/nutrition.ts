export type Nutrients = Record<string, number | null>;

/** Codata/FAO factor. kcal and kJ are never used interchangeably. */
export const KJ_PER_KCAL = 4.184;
/** Salt = sodium x 2.5 (molar mass NaCl / Na). */
export const SALT_PER_SODIUM = 2.5;

export const kcalToKj = (kcal: number) => kcal * KJ_PER_KCAL;
export const kjToKcal = (kj: number) => kj / KJ_PER_KCAL;
export const kgToG = (kg: number) => kg * 1000;
export const gToKg = (g: number) => g / 1000;
export const sodiumToSalt = (sodiumG: number) => sodiumG * SALT_PER_SODIUM;
export const saltToSodium = (saltG: number) => saltG / SALT_PER_SODIUM;

/** Atwater factors, only ever used for the diagnostic "calculated energy" view. */
export const ATWATER = { protein: 4, carbohydrate: 4, fat: 9, fiber: 2, alcohol: 7 } as const;

/**
 * Energy recomputed from macros. This is a diagnostic value: the source energy
 * is authoritative and is never overwritten with this number.
 */
export function calculatedEnergyKcal(values: Nutrients): number | null {
  const parts: number[] = [];
  for (const [key, factor] of Object.entries(ATWATER)) {
    const value = values[key];
    if (value == null) {
      if (key === "fiber" || key === "alcohol") continue; // optional contributors
      return null;
    }
    parts.push(value * factor);
  }
  return parts.reduce((sum, part) => sum + part, 0);
}

export function scaleNutrients(values: Nutrients, basisAmount: number, amount: number): Nutrients {
  if (basisAmount <= 0 || amount < 0 || !Number.isFinite(basisAmount) || !Number.isFinite(amount)) {
    throw new RangeError("Amounts must be valid and basis positive");
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === null ? null : (value * amount) / basisAmount]),
  );
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Nutrients = {};
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    // Unknown plus known stays unknown; a missing value is not zero.
    out[key] = left == null || right == null ? null : left + right;
  }
  return out;
}

/**
 * Sums nutrients across entries while tracking how much of the total amount
 * actually carried a value, so the UI can say "63 % coverage" instead of "0 mg".
 */
export function sumWithCoverage(
  entries: { amount: number; nutrients: Nutrients }[],
  keys?: string[],
): { known: Nutrients; coverage: Record<string, number | null>; total: Nutrients } {
  const allKeys = keys ?? [...new Set(entries.flatMap((e) => Object.keys(e.nutrients)))];
  const known: Nutrients = {};
  const total: Nutrients = {};
  const coverage: Record<string, number | null> = {};

  for (const key of allKeys) {
    let knownSum = 0;
    let knownAmount = 0;
    let totalAmount = 0;
    let anyUnknown = false;

    for (const entry of entries) {
      totalAmount += entry.amount;
      const value = entry.nutrients[key];
      if (value == null) anyUnknown = true;
      else {
        knownSum += value;
        knownAmount += entry.amount;
      }
    }

    known[key] = knownAmount === 0 ? null : knownSum;
    total[key] = anyUnknown ? null : knownSum;
    coverage[key] = totalAmount === 0 ? null : knownAmount / totalAmount;
  }

  return { known, coverage, total };
}

export function recipeNutrition(
  ingredients: { nutrients: Nutrients; basisAmount: number; amount: number; weightG?: number }[],
  servings: number,
  yieldWeightG?: number,
) {
  if (servings <= 0) throw new RangeError("Servings must be positive");
  const scaled = ingredients.map((i) => ({
    amount: i.amount,
    nutrients: scaleNutrients(i.nutrients, i.basisAmount, i.amount),
  }));
  const { total, known, coverage } = sumWithCoverage(scaled);
  const ingredientWeightG = ingredients.reduce((sum, i) => sum + (i.weightG ?? i.amount), 0);
  // A recipe that loses water when cooked keeps its nutrients but weighs less,
  // so per-100 g values must use the yield, never the raw ingredient weight.
  const finalWeightG = yieldWeightG ?? ingredientWeightG;

  return {
    total,
    known,
    coverage,
    perServing: scaleNutrients(total, servings, 1),
    knownPerServing: scaleNutrients(known, servings, 1),
    ingredientWeightG,
    finalWeightG,
    portionWeightG: finalWeightG / servings,
    per100g: finalWeightG > 0 ? scaleNutrients(total, finalWeightG, 100) : null,
  };
}

/** Fraction of the logged amount that carried a usable value for this nutrient. */
export function nutrientCoverage(items: { amount: number; value: number | null }[]) {
  const all = items.reduce((sum, item) => sum + item.amount, 0);
  const known = items.reduce((sum, item) => sum + (item.value === null ? 0 : item.amount), 0);
  return all === 0 ? null : known / all;
}

export function roundForDisplay(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
