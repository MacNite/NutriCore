import { z } from "zod";

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
  estimatedServingWeightG: z.number().positive().max(100_000).optional(),
  assumptions: z.array(z.string().max(500)).max(20).default([]),
  sources: z.array(z.object({ title: z.string().max(300), url: z.url() })).max(10).default([]),
  confidence: z.number().min(0).max(1),
  /** Set when the model supplied nutrition numbers directly instead of ingredients. */
  modelEstimated: z.boolean().default(false),
});

export type ResearchResult = z.infer<typeof researchResultSchema>;

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
