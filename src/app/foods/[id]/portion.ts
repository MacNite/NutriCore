import { normalizeUnit, resolvePortion, type PortionContext } from "@/lib/units";
import { scaleNutrients, type Nutrients } from "@/lib/nutrition";

/** The measuring facts of one food, as the portion form and its preview need them. */
export interface FoodShape {
  id: string;
  basisUnit: string;
  servingSize: number | null;
  servingUnit: string | null;
  densityGPerMl: number | null;
  servings: { label: string; gramEquivalent: number | null; mlEquivalent: number | null }[];
}

export const baseUnitOf = (food: Pick<FoodShape, "basisUnit">) => (food.basisUnit === "ML" ? "ml" : "g");

/**
 * Every unit the portion field offers, most natural first.
 *
 * Shared with the page so the initial quantity the form shows and the portion
 * the nutrient preview scales to are derived from the same list: an initial
 * unit the dropdown does not offer would leave the two disagreeing.
 */
export function portionUnits(food: FoodShape): string[] {
  const base = baseUnitOf(food);
  return [
    base,
    ...(food.basisUnit === "ML" ? ["l"] : ["kg"]),
    ...(food.densityGPerMl ? (food.basisUnit === "ML" ? ["g"] : ["ml"]) : []),
    ...(food.servingSize && food.servingUnit ? [food.servingUnit] : []),
    ...food.servings.map((s) => s.label),
  ].filter((unit, index, all) => all.indexOf(unit) === index);
}

/** The quantity and unit the form starts with; the unit is always one it offers. */
export function initialPortion(food: FoodShape): { quantity: string; unit: string } {
  const units = portionUnits(food);
  const baseUnit = baseUnitOf(food);
  // A recipe's `servingSize` is the calculated weight of one portion, not a
  // count of portions. Start with that weight in grams instead of accidentally
  // interpreting (for example) 64 g as 64 servings.
  const wanted = food.servingUnit === "serving" ? baseUnit : (food.servingUnit ?? baseUnit);
  return {
    // Imported and calculated serving weights can contain several decimal
    // places. The initial input is a practical portion suggestion, so present
    // it as a whole number while still allowing the person to edit it.
    quantity: String(food.servingSize === null ? 100 : Math.round(food.servingSize)),
    unit: units.includes(wanted) ? wanted : baseUnit,
  };
}

export function foodPortionContext(food: FoodShape): PortionContext {
  return {
    basisUnit: food.basisUnit === "ML" ? "ML" : "G",
    densityGPerMl: food.densityGPerMl,
    servings: food.servings.map((serving) => ({
      label: serving.label,
      amount: 1,
      unit: serving.label,
      gramEquivalent: serving.gramEquivalent,
      mlEquivalent: serving.mlEquivalent,
    })),
  };
}

export interface PortionPreview {
  /** The amount in the food's basis unit, or null when the entry cannot be resolved. */
  amount: number | null;
  basisUnit: "G" | "ML";
  /** Nutrients for that amount, or null while the entry is unusable. */
  nutrients: Nutrients | null;
  /** True when the entered unit is not the basis unit, so the resolved amount is worth showing. */
  converted: boolean;
}

/**
 * The nutrients for the portion currently typed into the form.
 *
 * Resolution goes through `resolvePortion`, the same rule the save applies, so
 * the preview can never promise values for a portion the diary would reject -
 * an unresolvable entry yields null rather than a guessed conversion.
 */
export function portionPreview(
  quantity: number,
  unit: string,
  food: FoodShape,
  nutrients: Nutrients,
  basisAmount: number,
): PortionPreview {
  const context = foodPortionContext(food);
  const basisUnit = context.basisUnit;
  const resolved = resolvePortion(quantity, unit, context);
  if (!resolved.ok || basisAmount <= 0) {
    return { amount: null, basisUnit, nutrients: null, converted: false };
  }
  return {
    amount: resolved.amount,
    basisUnit: resolved.unit,
    nutrients: scaleNutrients(nutrients, basisAmount, resolved.amount),
    converted: normalizeUnit(unit) !== baseUnitOf(food),
  };
}
