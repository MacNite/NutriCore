export type Sex = "male" | "female";
export function mifflinStJeor(weightKg: number, heightCm: number, age: number, sex: Sex) {
  if (weightKg <= 0 || heightCm <= 0 || age <= 0) throw new RangeError("Profile values must be positive");
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}
export function calorieTarget(input: { bmr: number; activityMultiplier: number; goalAdjustment: number; override?: number; age?: number; pregnant?: boolean; breastfeeding?: boolean }) {
  if (input.age !== undefined && input.age < 18 || input.pregnant || input.breastfeeding) return { eligible: false as const, warning: "medical-guidance-required" };
  const tdee = input.bmr * input.activityMultiplier;
  const adjustment = Math.max(-500, Math.min(500, input.goalAdjustment));
  return { eligible: true as const, bmr: input.bmr, activityMultiplier: input.activityMultiplier, tdee, goalAdjustment: adjustment, calculated: tdee + adjustment, final: input.override ?? tdee + adjustment };
}
