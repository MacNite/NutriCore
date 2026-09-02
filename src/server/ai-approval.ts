import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAiModel } from "@/lib/env";
import { normalizeName } from "@/lib/units";
import { addDiaryEntry, formatDateKey } from "./diary";
import { saveRecipe } from "./recipes";
import { decideComponents, jobOutcome, quickMealOptions, quickMealRecipeName, type AcceptedOutcome, type AiJobOutcome, type ProposedComponent } from "./ai-types";

/**
 * Applies an approved proposal to the diary.
 *
 * Extracted from the review action so three callers can share it: the review
 * screen, the one-click accept in the dashboard, and the worker itself when the
 * user has asked for proposals to be applied without review. Whichever calls it,
 * the same rules decide what may be logged and the same outcome is recorded.
 */

/**
 * Creates the food behind an approved estimate.
 *
 * `sourceType: AI_RESEARCH` and `isEstimated` are deliberate: ranking must keep
 * treating these with the low trust an estimate deserves, so they never outrank
 * a sourced food in search. `AI_MEAL_ESTIMATE` on the source row is the only
 * provider value that means "the model said so and this was accepted".
 */
async function createEstimatedFood(
  user: { id: string; language: "de" | "en" },
  component: ProposedComponent,
) {
  const nutrients = Object.entries(component.nutritionPer100g ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([nutrientKey, value]) => ({ nutrientKey, value }));

  return prisma.food.create({
    data: {
      ownerId: user.id,
      name: component.name,
      normalizedName: normalizeName(component.name),
      locale: user.language,
      sourceType: "AI_RESEARCH",
      foodType: "GENERIC",
      basisAmount: 100,
      basisUnit: "G",
      isEstimated: true,
      nutrients: { createMany: { data: nutrients } },
      sources: {
        create: [{ provider: "AI_MEAL_ESTIMATE", retrievedAt: new Date(), model: resolveAiModel(), estimated: true }],
      },
    },
  });
}

/** The dish name the extraction settled on, kept on the job so approval can reuse it. */
function extractedName(metadata: unknown) {
  const name = (metadata as { extraction?: { name?: unknown } } | null)?.extraction?.name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Stores a quick meal as a draft recipe, when the submitter asked for one.
 *
 * A draft, never an active recipe: these ingredients are a model's reading of a
 * sentence, and a draft is exactly the state the app already has for "extracted
 * but not reviewed" - it is listed and editable but gets no Food entry, so
 * nothing here can be logged before someone has confirmed it.
 *
 * Called twice for the same job in the ordinary case: once by the worker, from
 * whatever the resolver matched on its own, and again when the proposal is
 * approved, from what was actually logged. So it updates the recipe it wrote
 * last time rather than adding a second one - and a recipe the user has already
 * confirmed is left exactly as they confirmed it.
 *
 * Runs after the job is already COMPLETED, so it must not throw: recordFailure
 * would put the whole extraction back in the queue for the sake of a follow-up.
 */
export async function storeQuickMealRecipe(
  job: { id: string; userId: string; metadata: Prisma.JsonValue | null },
  name: string,
  ingredients: Array<{ foodId: string; amount: number; unit: string }>,
): Promise<{ recipeId: string; recipeName: string } | { recipeSkipped: true } | null> {
  try {
    if (!ingredients.length) {
      // Said out loud rather than only logged: the submitter ticked a box and is
      // owed an answer about why the list they went looking in stayed empty.
      logger.info("Quick meal recipe skipped: nothing resolved to a food", { jobId: job.id });
      return { recipeSkipped: true };
    }

    const existingId = jobOutcome(job.metadata)?.recipeId;
    const existing = existingId
      ? await prisma.recipe.findFirst({ where: { id: existingId, ownerId: job.userId }, select: { id: true, status: true } })
      : null;
    // Already accepted by the user; neither a later approval nor a retry of this
    // job may undo that.
    if (existing?.status === "ACTIVE") return { recipeId: existing.id, recipeName: name };

    // The components were already scaled to one portion by the extraction, so
    // the recipe this builds is that one portion.
    const { recipe } = await saveRecipe(
      job.userId,
      { name, description: "", servings: 1, instructions: "", tags: [], ingredients },
      existing?.id,
      { status: "DRAFT", sourceType: "AI_RESEARCH" },
    );

    // Read back rather than reused from the claim: the extraction was cached
    // into metadata after this job was claimed, and writing the stale copy here
    // would discard it - which on a later retry means running the model again.
    const current = await prisma.aiJob.findUnique({ where: { id: job.id }, select: { metadata: true } });
    const metadata = { ...((current?.metadata ?? {}) as Record<string, unknown>) };
    const outcome: AiJobOutcome = {
      ...((metadata.outcome ?? {}) as AiJobOutcome),
      recipeId: recipe.id,
      recipeName: recipe.name,
      ingredientCount: ingredients.length,
    };
    await prisma.aiJob.update({
      where: { id: job.id },
      data: { metadata: { ...metadata, outcome } as unknown as Prisma.InputJsonValue },
    });
    return { recipeId: recipe.id, recipeName: recipe.name };
  } catch (error) {
    logger.warn("Could not store the quick meal as a recipe", {
      jobId: job.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export class ProposalNotPendingError extends Error {
  constructor() {
    super("Proposal is not awaiting review");
    this.name = "ProposalNotPendingError";
  }
}

/**
 * Logs what a proposal permits and records what it did.
 *
 * A component is logged when a food was resolved for it - by the worker or by
 * `selection` - or, failing that, when the model stated nutrition and that
 * estimate is accepted; the estimate then gets its own food so the diary entry
 * freezes a snapshot exactly like any other. A component with neither is
 * reported as skipped rather than logged as zero calories.
 *
 * `selection` is the reviewer's per-component choice. The worker passes none,
 * which leaves the resolver's own choices standing.
 */
export async function applyProposal(
  proposalId: string,
  options: { selection?: (index: number) => string | null | undefined } = {},
): Promise<AcceptedOutcome> {
  const proposal = await prisma.aiProposal.findUnique({
    where: { id: proposalId },
    include: { job: { include: { mealInput: true, user: { select: { id: true, profile: { select: { language: true } } } } } } },
  });
  if (!proposal || proposal.approvalStatus !== "PENDING") throw new ProposalNotPendingError();

  const mealInput = proposal.job.mealInput;
  if (!mealInput) throw new Error("Proposal has no meal to log against");

  const user = { id: proposal.job.userId, language: proposal.job.user.profile?.language ?? ("de" as const) };
  const components = (proposal.proposed as { components?: ProposedComponent[] }).components ?? [];
  const { loggable, skipped, skippedDetails } = decideComponents(components, options.selection);

  const date = formatDateKey(mealInput.diaryDate);
  const logged: string[] = [];
  const estimated: string[] = [];
  // The same food and weight the diary entry was written from, so a recipe kept
  // from this approval is the meal that was logged rather than a second reading
  // of it. An accepted estimate carries the food that was created for it here.
  const recipeIngredients: Array<{ foodId: string; amount: number; unit: string }> = [];

  for (const { component, foodId: chosenFoodId, grams } of loggable) {
    try {
      const foodId = chosenFoodId ?? (await createEstimatedFood(user, component)).id;
      await addDiaryEntry({ userId: user.id, date, meal: mealInput.meal, foodId, quantity: grams, unit: "g" });
      logged.push(component.name);
      recipeIngredients.push({ foodId, amount: grams, unit: "g" });
      if (!chosenFoodId) estimated.push(component.name);
    } catch (error) {
      // A food deleted since the proposal was made, or a portion that cannot be
      // resolved, is a skip and not a failed approval.
      logger.warn("Could not log an approved AI component", {
        proposalId,
        component: component.name,
        reason: error instanceof Error ? error.message : "unknown",
      });
      skipped.push(component.name);
      skippedDetails.push({ name: component.name, reason: "LOG_FAILED" });
    }
  }

  // Built here rather than in the worker, from the decisions this approval made.
  // The worker only ever knew what the resolver had matched on its own, so a
  // meal whose foods the reviewer chose produced no recipe at all - and a
  // partly matched one produced a recipe missing whatever the reviewer fixed.
  const kept = quickMealOptions(proposal.job.metadata).createRecipe
    ? await storeQuickMealRecipe(
        proposal.job,
        quickMealRecipeName(extractedName(proposal.job.metadata), mealInput.text ?? ""),
        recipeIngredients,
      )
    : null;

  const outcome: AcceptedOutcome = {
    logged, estimated, skipped, skippedDetails,
    ...(kept ?? {}),
    acceptedAt: new Date().toISOString(),
  };
  await prisma.aiProposal.update({
    where: { id: proposalId },
    data: {
      approvalStatus: "ACCEPTED",
      accepted: outcome as unknown as Prisma.InputJsonValue,
      reviewedAt: new Date(),
    },
  });
  return outcome;
}

/**
 * Applies a proposal on the user's behalf, for a user who asked not to review
 * every meal. Failure is deliberately not fatal to the job: the parse and the
 * resolution succeeded and are worth keeping, so an approval that could not be
 * completed leaves the proposal pending for the review screen instead of
 * discarding the whole meal.
 */
export async function autoApproveProposal(proposalId: string) {
  try {
    const outcome = await applyProposal(proposalId);
    logger.info("AI proposal applied without review", {
      proposalId,
      logged: outcome.logged.length,
      estimated: outcome.estimated?.length ?? 0,
      skipped: outcome.skipped.length,
    });
    return outcome;
  } catch (error) {
    logger.warn("Could not apply an AI proposal automatically", {
      proposalId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
