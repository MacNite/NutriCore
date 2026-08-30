import { z } from "zod";
export const researchResultSchema = z.object({
  kind: z.enum(["food", "recipe"]), name: z.string().min(1).max(200), language: z.enum(["de", "en"]),
  description: z.string().max(2000), ingredients: z.array(z.object({ name: z.string().min(1), amount: z.number().positive(), unit: z.enum(["g", "ml", "piece"]), confidence: z.number().min(0).max(1) })).min(1),
  servings: z.number().positive(), estimatedServingWeightG: z.number().positive().optional(), assumptions: z.array(z.string().max(500)).max(20),
  sources: z.array(z.object({ title: z.string(), url: z.url() })).max(10), confidence: z.number().min(0).max(1), modelEstimated: z.boolean().default(false)
});
export type ResearchResult = z.infer<typeof researchResultSchema>;
export const researchTransitions = { REQUESTED: ["SEARCHING", "FAILED"], SEARCHING: ["SOURCES_FOUND", "EXTRACTING", "FAILED"], SOURCES_FOUND: ["EXTRACTING", "FAILED"], EXTRACTING: ["MATCHING_INGREDIENTS", "FAILED"], MATCHING_INGREDIENTS: ["CALCULATING", "FAILED"], CALCULATING: ["AWAITING_CONFIRMATION", "FAILED"], AWAITING_CONFIRMATION: ["ACCEPTED", "REJECTED"], ACCEPTED: [], REJECTED: [], FAILED: [] } as const;
export function mayTransition(from: keyof typeof researchTransitions, to: string) { return (researchTransitions[from] as readonly string[]).includes(to); }
