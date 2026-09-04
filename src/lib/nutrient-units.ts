/**
 * Converting a nutrient amount between the units food databases publish.
 *
 * Every source uses its own scale for the same nutrient: BLS states copper and
 * manganese in µg where NutriCore stores mg, sodium in mg where NutriCore
 * stores g, and vitamin B6 in µg where NutriCore stores mg. Getting one of
 * those wrong is a factor-of-1000 error that looks perfectly plausible in a
 * table, so the conversion is deliberately narrow: only the pairs listed here
 * are convertible, and anything else throws rather than guessing.
 */

export class UnitConversionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`No known conversion from "${from}" to "${to}"`);
    this.name = "UnitConversionError";
  }
}

/** Mass in grams, the shared reference for every mass unit. */
const MASS_IN_GRAMS: Record<string, number> = {
  g: 1,
  mg: 1e-3,
  // Three spellings of the same unit occur in the wild: MICRO SIGN (U+00B5),
  // which BLS and FDC use, GREEK SMALL LETTER MU (U+03BC), which some exports
  // substitute, and "mcg" on labels. All are the same microgram.
  "µg": 1e-6,
  "μg": 1e-6,
  mcg: 1e-6,
};

const ENERGY_IN_KJ: Record<string, number> = { kJ: 1, kcal: 4.184 };

const canonical = (unit: string) => unit.trim();

/** True when the two units measure the same physical quantity. */
export function isConvertible(from: string, to: string): boolean {
  const a = canonical(from);
  const b = canonical(to);
  if (a === b) return true;
  if (a in MASS_IN_GRAMS && b in MASS_IN_GRAMS) return true;
  if (a in ENERGY_IN_KJ && b in ENERGY_IN_KJ) return true;
  return false;
}

/**
 * Converts `value` from one unit to another. Throws `UnitConversionError` when
 * the pair is not known, which is what stops an importer from quietly writing
 * a milligram figure into a microgram column.
 */
export function convertNutrientValue(value: number, from: string, to: string): number {
  const a = canonical(from);
  const b = canonical(to);
  if (a === b) return value;

  const massFrom = MASS_IN_GRAMS[a];
  const massTo = MASS_IN_GRAMS[b];
  if (massFrom !== undefined && massTo !== undefined) return (value * massFrom) / massTo;

  const energyFrom = ENERGY_IN_KJ[a];
  const energyTo = ENERGY_IN_KJ[b];
  if (energyFrom !== undefined && energyTo !== undefined) return (value * energyFrom) / energyTo;

  throw new UnitConversionError(from, to);
}

/**
 * Rounds away the floating-point dust a conversion leaves behind, while
 * keeping the source's own precision.
 *
 * Dividing 484 µg of copper by 1000 gives 0.484 exactly, but 6160 µg of
 * manganese gives 6.16 and 33.6 µg gives 0.033600000000000004. Twelve
 * significant digits is far more than any nutrient is measured to and far less
 * than the 18,6 the column stores, so nothing real is lost.
 */
export function tidyNutrientValue(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Number.isInteger(value)) return value;
  return Number(value.toPrecision(12));
}
