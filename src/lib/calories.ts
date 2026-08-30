export type Sex = "male" | "female";
export type BiologicalSex = "MALE" | "FEMALE" | "UNSPECIFIED";
export type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
export type Goal = "LOSE" | "MAINTAIN" | "GAIN" | "CUSTOM";

/** Physical activity levels. Values are the widely used Mifflin-St Jeor multipliers. */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
};

/** Conservative default adjustments. Extreme deficits are never generated. */
export const GOAL_ADJUSTMENTS: Record<Exclude<Goal, "CUSTOM">, number> = {
  LOSE: -400,
  MAINTAIN: 0,
  GAIN: 300,
};

export const MAX_AUTOMATIC_ADJUSTMENT = 500;
/** Floor below which an automatically generated target is never placed. */
export const MIN_AUTOMATIC_TARGET_KCAL = 1200;

export function mifflinStJeor(weightKg: number, heightCm: number, age: number, sex: Sex) {
  if (weightKg <= 0 || heightCm <= 0 || age <= 0) throw new RangeError("Profile values must be positive");
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

export function ageFromBirthDate(birthDate: Date, now = new Date()) {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return age;
}

export interface CalorieTargetInput {
  bmr: number;
  activityMultiplier: number;
  goalAdjustment: number;
  override?: number;
  age?: number;
  pregnant?: boolean;
  breastfeeding?: boolean;
}

export type CalorieTargetResult =
  | { eligible: false; warning: "medical-guidance-required"; final: number | null }
  | {
      eligible: true;
      bmr: number;
      activityMultiplier: number;
      tdee: number;
      goalAdjustment: number;
      calculated: number;
      final: number;
      clamped: boolean;
    };

/**
 * Every component is returned so the UI can show the whole derivation rather
 * than a single opaque number. These are estimates, not medical measurements.
 */
export function calorieTarget(input: CalorieTargetInput): CalorieTargetResult {
  if ((input.age !== undefined && input.age < 18) || input.pregnant || input.breastfeeding) {
    // No weight-loss maths for minors, pregnancy or breastfeeding. A manual
    // override is still honoured so the diary stays usable.
    return { eligible: false, warning: "medical-guidance-required", final: input.override ?? null };
  }

  const tdee = input.bmr * input.activityMultiplier;
  const requested = Math.max(-MAX_AUTOMATIC_ADJUSTMENT, Math.min(MAX_AUTOMATIC_ADJUSTMENT, input.goalAdjustment));
  const rawCalculated = tdee + requested;
  const calculated = Math.max(MIN_AUTOMATIC_TARGET_KCAL, rawCalculated);

  return {
    eligible: true,
    bmr: input.bmr,
    activityMultiplier: input.activityMultiplier,
    tdee,
    // Report the adjustment actually applied after the floor, so the shown
    // parts always add up to the shown total.
    goalAdjustment: calculated - tdee,
    calculated,
    final: input.override ?? calculated,
    clamped: requested !== input.goalAdjustment || calculated !== rawCalculated,
  };
}

/**
 * Default macro split: protein and fat are set per kilogram of body weight,
 * carbohydrate takes the remainder so the macros always match the energy target.
 */
export function defaultMacroTargets(kcal: number, weightKg: number) {
  const proteinG = Math.round(Math.min(2.2, Math.max(1.2, 1.6)) * weightKg);
  const fatG = Math.round((kcal * 0.3) / 9);
  const remaining = kcal - proteinG * 4 - fatG * 9;
  const carbohydrateG = Math.max(0, Math.round(remaining / 4));
  return { proteinG, fatG, carbohydrateG };
}

export function sexForEquation(sex: BiologicalSex): Sex | null {
  if (sex === "MALE") return "male";
  if (sex === "FEMALE") return "female";
  return null;
}
