"use server";

import { redirect } from "next/navigation";
import { checkUrl } from "@/lib/url-guard";
import { requireUser } from "./session";
import { aiAvailable } from "./ai-availability";
import { queueAiIngestion } from "./ai-ingestion-queue";
import { imageUploadMaxBytes } from "@/lib/image-upload-limit";
import type { ComponentCandidate, ProposedComponent } from "./ai-types";
import { MEAL_IMAGE_TTL_MS } from "./meal-image";

const MAX_IMAGE_BYTES = imageUploadMaxBytes();
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type RecipeImportError =
  | "inputRequired"
  | "imageInvalid"
  | "imageTooLarge"
  | "aiDisabled"
  | "unsafeUrl"
  | "extractionFailed";

export interface RecipeImportDraft {
  name: string;
  description: string;
  servings: number;
  instructions: string;
  /** `units` is what this food can be measured in, for the form's dropdown. */
  ingredients: Array<{ foodId: string; name: string; amount: number; unit: string; units?: string[]; sourceLine?: string; resolution?: "deterministic" | "ai-assisted" | "unresolved"; candidates?: ComponentCandidate[] }>;
  components?: ProposedComponent[];
  warnings?: string[];
  unmatched: string[];
  /**
   * Ingredients whose food was found but whose source unit cannot be converted
   * for it - "2 EL Olivenöl" where the food defines no spoon. Reported rather
   * than converted, because a spoon has no weight this code is entitled to
   * invent. Optional: drafts written before this existed do not carry it.
   */
  unconverted?: string[];
  /**
   * Ingredients whose gram weight is the model's reading of a household measure
   * - "1 EL Mehl" as 10 g - rather than an amount the source stated or the food
   * itself defines. They are in the recipe, because nothing else can convert a
   * spoon and dropping them lost the ingredient entirely; they are listed here
   * because a weight nobody wrote down is the first thing worth checking.
   */
  estimatedWeights?: string[];
  /**
   * Ingredients weighed through a density this app assumed for the food rather
   * than one the food states - every Open Food Facts liquid, which publishes
   * none. They are in the recipe, because dropping them lost most liquids from
   * most recipes; they are listed because the weight rests on an assumption
   * about the food, and a reader who knows the product can correct it.
   */
  assumedDensity?: string[];
  /** Structured source lines that had no explicit deterministic quantity. */
  unparsedIngredients?: string[];
  /**
   * Ingredients that were matched with the model's help rather than by the
   * deterministic rules alone. These are the rows worth checking first: the
   * quantity is the source's, but the food is a judgement call.
   */
  aiAssistedIngredients?: string[];
  /** Aggregate diagnostics only; no page body or image data is retained here. */
  resolutionDiagnostics?: {
    ingredientCount: number;
    deterministicallyResolvedCount: number;
    aiAssistedCount: number;
    unresolvedCount: number;
    unquantifiedCount: number;
    ollamaCallsUsed: number;
  };
  /** The draft recipe stored under the user's recipes, once the worker made one. */
  recipeId?: string;
}

/**
 * Queues a recipe extraction. No model is called here.
 *
 * This used to do the whole extraction inside the server action, which meant a
 * page interaction waiting for a local model to finish - minutes on CPU-only
 * hardware, longer than the browser or the platform will hold the request open.
 * The user is sent to `/recipes/new?import=<id>` immediately and the worker
 * fills in the draft, with the retry budget and failure diagnostics every other
 * AI job has.
 */
export async function queueRecipeImportAction(formData: FormData) {
  const user = await requireUser();
  const back = (error: RecipeImportError) => redirect(`/recipes/new?importError=${error}`);

  // The same reading as the quick meal, so the two entry points cannot disagree
  // about whether AI is switched on.
  if (!aiAvailable(user)) back("aiDisabled");

  const text = String(formData.get("text") ?? "").trim().slice(0, 5000);
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim().slice(0, 500);
  const servings = Number(formData.get("servings"));
  const image = formData.get("image");
  const hasImage = image instanceof File && image.size > 0;

  if (!text && !sourceUrl && !hasImage) back("inputRequired");
  if (!Number.isFinite(servings) || servings <= 0 || servings > 10_000) back("inputRequired");
  if (hasImage && !IMAGE_TYPES.has(image.type)) back("imageInvalid");
  if (hasImage && image.size > MAX_IMAGE_BYTES) back("imageTooLarge");
  // Checked here, where a rejection can still be shown on the form, rather than
  // surfacing later as an unexplained worker failure.
  if (sourceUrl && !(await checkUrl(sourceUrl)).ok) back("unsafeUrl");

  /* The same deadline the quick-meal path uses, rather than a second literal
     that can drift from it: both write to one table now, and one sweeper
     enforces it. Minutes, not a day - the window an image can be caught in a
     database dump is the window that matters. */
  const record = await queueAiIngestion({ userId: user.id, intent: "RECIPE", text, sourceUrl: sourceUrl || null, servings, imageMime: hasImage ? image.type : null, imageData: hasImage ? Buffer.from(await image.arrayBuffer()) : null, imageExpiresAt: hasImage ? new Date(Date.now() + MEAL_IMAGE_TTL_MS) : null });
  redirect(`/recipes/new?import=${record.id}`);
}
