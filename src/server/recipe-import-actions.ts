"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveAiModel } from "@/lib/env";
import { checkUrl } from "@/lib/url-guard";
import { requireUser } from "./session";
import { jobPriority } from "./ai-types";
import { imageUploadMaxBytes } from "@/lib/image-upload-limit";

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
  ingredients: Array<{ foodId: string; name: string; amount: number; unit: string; units?: string[] }>;
  unmatched: string[];
  /**
   * Ingredients whose food was found but whose source unit cannot be converted
   * for it - "2 EL Olivenöl" where the food defines no spoon. Reported rather
   * than converted, because a spoon has no weight this code is entitled to
   * invent. Optional: drafts written before this existed do not carry it.
   */
  unconverted?: string[];
  /** Structured source lines that had no explicit deterministic quantity. */
  unparsedIngredients?: string[];
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

  if (!user.aiEnabled || (process.env.AI_ENABLED ?? "true") === "false") back("aiDisabled");

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

  const record = await prisma.recipeImport.create({
    data: {
      userId: user.id,
      text: text || null,
      sourceUrl: sourceUrl || null,
      servings,
      imageMime: hasImage ? image.type : null,
      imageData: hasImage ? Buffer.from(await image.arrayBuffer()) : null,
    },
  });
  await prisma.aiJob.create({
    data: {
      userId: user.id,
      entityType: "RECIPE_IMPORT",
      entityId: record.id,
      priority: jobPriority("RECIPE_IMPORT"),
      model: resolveAiModel(),
    },
  });

  redirect(`/recipes/new?import=${record.id}`);
}
