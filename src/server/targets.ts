import { prisma } from "@/lib/db";
import {
  ACTIVITY_MULTIPLIERS,
  GOAL_ADJUSTMENTS,
  ageFromBirthDate,
  calorieTarget,
  defaultMacroTargets,
  mifflinStJeor,
  sexForEquation,
  type CalorieTargetResult,
} from "@/lib/calories";

export interface TargetView {
  result: CalorieTargetResult | null;
  /** Why no calculation was possible, if it wasn't. */
  missing: string[];
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
  overrideKcal: number | null;
}

/**
 * Recomputes the target from the profile and stores every component, so the UI
 * can show the whole derivation rather than a single number.
 */
export async function recalculateTarget(userId: string): Promise<TargetView> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const latest = await prisma.nutritionTarget.findFirst({
    where: { userId },
    orderBy: { validFrom: "desc" },
  });

  const overrideKcal = latest?.overrideKcal ? Number(latest.overrideKcal) : null;

  if (!profile) return { result: null, missing: ["profile"], proteinG: null, carbohydrateG: null, fatG: null, overrideKcal };

  const missing: string[] = [];
  if (!profile.birthDate) missing.push("birthDate");
  if (!profile.heightCm) missing.push("heightCm");
  if (!profile.weightKg) missing.push("weightKg");
  const sex = sexForEquation(profile.biologicalSex);
  if (!sex) missing.push("biologicalSex");

  if (missing.length > 0) {
    return { result: null, missing, proteinG: null, carbohydrateG: null, fatG: null, overrideKcal };
  }

  const age = ageFromBirthDate(profile.birthDate!);
  const bmr = mifflinStJeor(Number(profile.weightKg), Number(profile.heightCm), age, sex!);
  const activityMultiplier = ACTIVITY_MULTIPLIERS[profile.activityLevel];
  const goalAdjustment = profile.goal === "CUSTOM" ? 0 : GOAL_ADJUSTMENTS[profile.goal];

  const result = calorieTarget({
    bmr,
    activityMultiplier,
    goalAdjustment,
    override: overrideKcal ?? undefined,
    age,
    pregnant: profile.isPregnant,
    breastfeeding: profile.isBreastfeeding,
  });

  const finalKcal = result.eligible ? result.final : (result.final ?? null);
  const macros =
    finalKcal !== null && profile.weightKg ? defaultMacroTargets(finalKcal, Number(profile.weightKg)) : null;

  await prisma.nutritionTarget.create({
    data: {
      userId,
      bmrKcal: result.eligible ? result.bmr : null,
      activityMultiplier: result.eligible ? result.activityMultiplier : null,
      tdeeKcal: result.eligible ? result.tdee : null,
      goalAdjustmentKcal: result.eligible ? result.goalAdjustment : null,
      calculatedKcal: result.eligible ? result.calculated : null,
      overrideKcal,
      proteinG: macros?.proteinG ?? null,
      carbohydrateG: macros?.carbohydrateG ?? null,
      fatG: macros?.fatG ?? null,
      eligible: result.eligible,
    },
  });

  return {
    result,
    missing: [],
    proteinG: macros?.proteinG ?? null,
    carbohydrateG: macros?.carbohydrateG ?? null,
    fatG: macros?.fatG ?? null,
    overrideKcal,
  };
}

export async function getCurrentTarget(userId: string) {
  const target = await prisma.nutritionTarget.findFirst({ where: { userId }, orderBy: { validFrom: "desc" } });
  if (!target) return null;

  const calculated = target.calculatedKcal ? Number(target.calculatedKcal) : null;
  const override = target.overrideKcal ? Number(target.overrideKcal) : null;

  return {
    bmrKcal: target.bmrKcal ? Number(target.bmrKcal) : null,
    activityMultiplier: target.activityMultiplier ? Number(target.activityMultiplier) : null,
    tdeeKcal: target.tdeeKcal ? Number(target.tdeeKcal) : null,
    goalAdjustmentKcal: target.goalAdjustmentKcal ? Number(target.goalAdjustmentKcal) : null,
    calculatedKcal: calculated,
    overrideKcal: override,
    kcal: override ?? calculated,
    proteinG: target.proteinG ? Number(target.proteinG) : null,
    carbohydrateG: target.carbohydrateG ? Number(target.carbohydrateG) : null,
    fatG: target.fatG ? Number(target.fatG) : null,
    eligible: target.eligible,
  };
}

export type CurrentTarget = NonNullable<Awaited<ReturnType<typeof getCurrentTarget>>>;
