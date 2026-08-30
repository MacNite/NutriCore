export type Nutrients = Record<string, number | null>;
export const kcalToKj = (kcal: number) => kcal * 4.184;
export const kjToKcal = (kj: number) => kj / 4.184;
export const kgToG = (kg: number) => kg * 1000;
export const sodiumToSalt = (sodiumG: number) => sodiumG * 2.5;
export const saltToSodium = (saltG: number) => saltG / 2.5;

export function scaleNutrients(values: Nutrients, basisAmount: number, amount: number): Nutrients {
  if (basisAmount <= 0 || amount < 0) throw new RangeError("Amounts must be valid and basis positive");
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === null ? null : value * amount / basisAmount]));
}

export function recipeNutrition(ingredients: { nutrients: Nutrients; basisAmount: number; amount: number }[], servings: number) {
  if (servings <= 0) throw new RangeError("Servings must be positive");
  const keys = new Set(ingredients.flatMap((i) => Object.keys(i.nutrients)));
  const total: Nutrients = {};
  for (const key of keys) {
    const values = ingredients.map((i) => ({ value: i.nutrients[key], factor: i.amount / i.basisAmount }));
    total[key] = values.some((v) => v.value == null) ? null : values.reduce((sum, v) => sum + v.value! * v.factor, 0);
  }
  return { total, perServing: scaleNutrients(total, servings, 1) };
}

export function nutrientCoverage(items: { amount: number; value: number | null }[]) {
  const all = items.reduce((sum, item) => sum + item.amount, 0);
  const known = items.reduce((sum, item) => sum + (item.value === null ? 0 : item.amount), 0);
  return all === 0 ? null : known / all;
}

export function roundForDisplay(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
