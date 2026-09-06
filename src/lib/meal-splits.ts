import type { MealType } from "@prisma/client";

/**
 * How the day's energy allowance is divided over the four meals.
 *
 * There is no established "correct" split. The DGE states that the available
 * evidence supports no recommendation on how a healthy person should spread
 * intake over the day, and the trials on front-loading disagree with each
 * other: the 2022 Aberdeen crossover found no metabolic difference between a
 * big breakfast and a big dinner, only less hunger. So a split is guidance the
 * reader chooses, never a rule the application asserts - which is why the
 * feature is off until it is switched on, why every preset is offered beside
 * the classic one, and why a meal over its share is a hint rather than a
 * verdict on the day.
 */
export const MEAL_SPLIT_MEALS: MealType[] = ["BREAKFAST", "LUNCH", "DINNER", "SNACKS"];

export type MealSplit = Record<MealType, number>;

/**
 * The presets offered in Settings.
 *
 * `classic` is the traditional distribution taught alongside the DGE's
 * three-to-five-meal advice (25/30/25/20). It is the default because it maps
 * exactly onto the four meals this diary already has, and because it is the
 * one figure a German reader is likely to have met before.
 */
export const MEAL_SPLIT_PRESETS = {
  classic: { BREAKFAST: 25, LUNCH: 30, DINNER: 25, SNACKS: 20 },
  noSnacks: { BREAKFAST: 30, LUNCH: 40, DINNER: 30, SNACKS: 0 },
  frontLoaded: { BREAKFAST: 35, LUNCH: 35, DINNER: 20, SNACKS: 10 },
  eveningHeavy: { BREAKFAST: 20, LUNCH: 30, DINNER: 40, SNACKS: 10 },
} as const satisfies Record<string, MealSplit>;

export type MealSplitPreset = keyof typeof MEAL_SPLIT_PRESETS;

export const MEAL_SPLIT_PRESET_KEYS = Object.keys(MEAL_SPLIT_PRESETS) as MealSplitPreset[];

export const DEFAULT_MEAL_SPLIT: MealSplit = MEAL_SPLIT_PRESETS.classic;

/** A split has to account for the whole day, or the parts would not add up to the total. */
export const MEAL_SPLIT_TOTAL = 100;

/** Names the preset a split matches, so Settings can show which one is in effect. */
export function matchingPreset(split: MealSplit): MealSplitPreset | null {
  return MEAL_SPLIT_PRESET_KEYS.find((key) => MEAL_SPLIT_MEALS.every((meal) => MEAL_SPLIT_PRESETS[key][meal] === split[meal])) ?? null;
}

export const splitTotal = (split: MealSplit) => MEAL_SPLIT_MEALS.reduce((sum, meal) => sum + split[meal], 0);

/**
 * A share is a whole percent between 0 and 100, and the four have to total 100.
 * Zero is allowed - somebody who never snacks should be able to say so - but a
 * negative share or a total that misses 100 is refused rather than silently
 * rescaled, because a rescaled split is not the one the reader typed.
 */
export function isValidMealSplit(split: MealSplit) {
  const shares = MEAL_SPLIT_MEALS.map((meal) => split[meal]);
  if (shares.some((share) => !Number.isInteger(share) || share < 0 || share > MEAL_SPLIT_TOTAL)) return false;
  return shares.reduce((sum, share) => sum + share, 0) === MEAL_SPLIT_TOTAL;
}

/**
 * Divides a day's allowance over the meals.
 *
 * The remainder is handed out by largest fractional part, so the four targets
 * always sum to exactly the daily figure shown in the energy ring. Rounding
 * each share on its own would leave 1.990 kcal split as 498+597+498+398 =
 * 1.991, and a reader who adds up the four numbers notices.
 *
 * A meal whose share is zero always gets zero: it was deliberately given no
 * budget, so it must not collect a rounding remainder.
 */
export function mealTargets(dailyKcal: number | null, split: MealSplit): MealSplit | null {
  if (dailyKcal === null || !Number.isFinite(dailyKcal) || dailyKcal <= 0) return null;
  if (!isValidMealSplit(split)) return null;

  const exact = MEAL_SPLIT_MEALS.map((meal) => ({ meal, value: (dailyKcal * split[meal]) / MEAL_SPLIT_TOTAL }));
  const floors = exact.map((entry) => ({ ...entry, floor: Math.floor(entry.value) }));
  let remainder = Math.round(dailyKcal) - floors.reduce((sum, entry) => sum + entry.floor, 0);

  // Largest fractional part first; ties go to the meal that comes first in the
  // day, so the same split and the same target always produce the same numbers.
  const order = [...floors]
    .filter((entry) => split[entry.meal] > 0)
    .sort((a, b) => b.value - b.floor - (a.value - a.floor) || MEAL_SPLIT_MEALS.indexOf(a.meal) - MEAL_SPLIT_MEALS.indexOf(b.meal));

  const bonus = new Map<MealType, number>();
  for (const entry of order) {
    if (remainder <= 0) break;
    bonus.set(entry.meal, 1);
    remainder -= 1;
  }

  return Object.fromEntries(floors.map((entry) => [entry.meal, entry.floor + (bonus.get(entry.meal) ?? 0)])) as MealSplit;
}
