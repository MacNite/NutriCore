import { z } from "zod";
import type { Nutrients } from "./nutrition";

/**
 * Nutrition the model may state directly, per 100 g of the finished dish. It is
 * a fallback for dishes whose ingredients are not in the local database, never
 * a replacement for values calculated from real foods, and every value that
 * comes from here is stored as an estimate.
 */
export const modelNutritionSchema = z.object({
  energyKcal: z.number().min(0).max(900),
  protein: z.number().min(0).max(100),
  carbohydrate: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
  saturatedFat: z.number().min(0).max(100).optional(),
  sugar: z.number().min(0).max(100).optional(),
  fiber: z.number().min(0).max(100).optional(),
  salt: z.number().min(0).max(100).optional(),
});

/**
 * The contract an AI research result must satisfy before it is ever shown to a
 * user. Ingredients are required: the model reconstructs a dish, it does not
 * invent calorie totals.
 */
export const researchResultSchema = z.object({
  kind: z.enum(["food", "recipe"]),
  name: z.string().trim().min(1).max(200),
  language: z.enum(["de", "en"]),
  description: z.string().max(2000).default(""),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        amount: z.number().positive().max(100_000),
        unit: z.enum(["g", "ml", "piece"]),
        confidence: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(60),
  servings: z.number().positive().max(100),
  /** Weight of ONE serving, not of the whole yield. */
  estimatedServingWeightG: z.number().positive().max(100_000).optional(),
  /**
   * Optional: omitting it costs nothing, because a result is still usable when
   * every ingredient resolves against the local database.
   */
  nutritionPer100g: modelNutritionSchema.optional(),
  assumptions: z.array(z.string().max(500)).max(20).default([]),
  sources: z.array(z.object({ title: z.string().max(300), url: z.url() })).max(10).default([]),
  confidence: z.number().min(0).max(1),
  /** Set when the model supplied nutrition numbers directly instead of ingredients. */
  modelEstimated: z.boolean().default(false),
});

export type ResearchResult = z.infer<typeof researchResultSchema>;

/**
 * The model states the weight of a single serving, while recipe maths needs the
 * weight of everything that came out of the pot. Feeding one to the other makes
 * per-100 g values wrong by exactly the number of servings.
 */
export function totalYieldWeightG(servings: number, estimatedServingWeightG?: number): number | undefined {
  if (estimatedServingWeightG === undefined) return undefined;
  if (!Number.isFinite(servings) || servings <= 0) return estimatedServingWeightG;
  return estimatedServingWeightG * servings;
}

/** Where the nutrition shown for a research result came from. */
export type NutritionSource = "INGREDIENTS" | "MODEL" | "PARTIAL_INGREDIENTS" | "NONE";

export const hasAnyNutrient = (values: Nutrients | null | undefined) =>
  Boolean(values && Object.values(values).some((value) => value !== null && value !== undefined));

/**
 * Calculated values win whenever every ingredient resolved against a real food.
 * They are not mixed with model numbers: the two use different denominators, so
 * a blend would be neither. A partial ingredient calculation is only used when
 * the model supplied nothing at all, because dividing by the matched weight
 * silently assumes the unmatched rest has the same nutrition.
 */
export function chooseNutrition(input: {
  calculatedPer100g: Nutrients | null;
  modelPer100g?: Nutrients;
  matchedIngredientRatio: number;
}): { per100g: Nutrients; source: NutritionSource } {
  const calculated = hasAnyNutrient(input.calculatedPer100g) ? input.calculatedPer100g! : null;
  const model = hasAnyNutrient(input.modelPer100g) ? input.modelPer100g! : null;

  if (calculated && input.matchedIngredientRatio >= 1) return { per100g: calculated, source: "INGREDIENTS" };
  if (model) return { per100g: model, source: "MODEL" };
  if (calculated) return { per100g: calculated, source: "PARTIAL_INGREDIENTS" };
  return { per100g: {}, source: "NONE" };
}

export type ResearchStatus =
  | "REQUESTED"
  | "SEARCHING"
  | "SOURCES_FOUND"
  | "EXTRACTING"
  | "MATCHING_INGREDIENTS"
  | "CALCULATING"
  | "AWAITING_CONFIRMATION"
  | "ACCEPTED"
  | "REJECTED"
  | "FAILED";

/**
 * Every path to ACCEPTED runs through AWAITING_CONFIRMATION, so a result can
 * never be stored without the user explicitly confirming it.
 */
export const researchTransitions: Record<ResearchStatus, readonly ResearchStatus[]> = {
  REQUESTED: ["SEARCHING", "EXTRACTING", "FAILED"],
  SEARCHING: ["SOURCES_FOUND", "EXTRACTING", "FAILED"],
  SOURCES_FOUND: ["EXTRACTING", "FAILED"],
  EXTRACTING: ["MATCHING_INGREDIENTS", "FAILED"],
  MATCHING_INGREDIENTS: ["CALCULATING", "FAILED"],
  CALCULATING: ["AWAITING_CONFIRMATION", "FAILED"],
  AWAITING_CONFIRMATION: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: [],
  FAILED: [],
};

export const TERMINAL_STATUSES: ResearchStatus[] = ["ACCEPTED", "REJECTED", "FAILED"];

export const mayTransition = (from: ResearchStatus, to: string) =>
  (researchTransitions[from] as readonly string[]).includes(to);

export interface ConfidenceSignals {
  sourceCount: number;
  sourcesAgree: boolean;
  /** Fraction of ingredients resolved against a trusted database food. */
  matchedIngredientRatio: number;
  allQuantitiesPresent: boolean;
  knownServingWeight: boolean;
  modelEstimatedNutrition: boolean;
  vagueDescription: boolean;
}

export interface ConfidenceResult {
  score: number;
  band: "high" | "medium" | "low";
  /** Human-readable reasons, shown so a user can judge the number. */
  reasons: { key: string; effect: number }[];
}

/**
 * Interpretable confidence: a transparent sum of named signals rather than an
 * opaque number produced by the model itself.
 */
export function scoreConfidence(signals: ConfidenceSignals): ConfidenceResult {
  const reasons: { key: string; effect: number }[] = [];
  let score = 0.3;

  const add = (key: string, effect: number) => {
    score += effect;
    if (effect !== 0) reasons.push({ key, effect });
  };

  if (signals.sourceCount >= 2) add("multipleSources", 0.15);
  else if (signals.sourceCount === 0) add("noSource", -0.15);

  if (signals.sourceCount >= 2 && signals.sourcesAgree) add("sourcesAgree", 0.1);
  if (signals.sourceCount >= 2 && !signals.sourcesAgree) add("sourcesConflict", -0.15);

  add("ingredientsMatched", signals.matchedIngredientRatio * 0.3);

  if (signals.allQuantitiesPresent) add("quantitiesPresent", 0.1);
  else add("missingQuantities", -0.2);

  if (signals.knownServingWeight) add("knownServingWeight", 0.05);
  if (signals.modelEstimatedNutrition) add("modelEstimatedNutrition", -0.25);
  if (signals.vagueDescription) add("vagueDescription", -0.1);

  const clamped = Math.max(0, Math.min(1, score));
  return {
    score: clamped,
    band: clamped >= 0.7 ? "high" : clamped >= 0.4 ? "medium" : "low",
    reasons,
  };
}
