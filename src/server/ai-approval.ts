import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAiModel } from "@/lib/env";
import { normalizeName } from "@/lib/units";
import { addDiaryEntry, formatDateKey } from "./diary";
import { deleteRecipe } from "./recipes";
import { decideComponents, jobOutcome, type AcceptedOutcome, type AiJobOutcome, type ProposedComponent } from "./ai-types";

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

/**
 * Drops the draft recipe a declined quick meal left behind.
 *
 * With `createRecipe` ticked and the proposal still awaiting review, the worker
 * has already stored a draft from whatever the resolver matched on its own -
 * before anyone said whether the meal was read correctly at all. Declining the
 * proposal used to leave that draft in the recipe list for good, with nothing
 * on it saying where it came from or why the meal it describes was never
 * logged. Rejecting the reading rejects the recipe built from it.
 *
 * A recipe the user has already confirmed is never touched: ACTIVE is their
 * decision and not this job's. The recipe id is cleared from the outcome too,
 * so the review page stops offering a link to something that is gone.
 *
 * Never throws: a rejection that could not clean up is still a rejection.
 */
export async function discardQuickMealRecipe(job: { id: string; userId: string; metadata: Prisma.JsonValue | null }) {
  const recipeId = jobOutcome(job.metadata)?.recipeId;
  if (!recipeId) return null;
  try {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, ownerId: job.userId },
      select: { id: true, status: true },
    });
    if (!recipe || recipe.status !== "DRAFT") return null;
    await deleteRecipe(job.userId, recipe.id);

    // Read back rather than reused from the caller: the job may have been
    // written since, and this only means to drop the two recipe keys.
    const current = await prisma.aiJob.findUnique({ where: { id: job.id }, select: { metadata: true } });
    const metadata = { ...((current?.metadata ?? {}) as Record<string, unknown>) };
    const outcome = { ...((metadata.outcome ?? {}) as AiJobOutcome) };
    delete outcome.recipeId;
    delete outcome.recipeName;
    await prisma.aiJob.update({
      where: { id: job.id },
      data: { metadata: { ...metadata, outcome } as unknown as Prisma.InputJsonValue },
    });
    return recipe.id;
  } catch (error) {
    logger.warn("Could not discard the draft recipe of a rejected quick meal", {
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
    include: { job: { include: { ingestionInput: true, user: { select: { id: true, profile: { select: { language: true } } } } } } },
  });
  if (!proposal || proposal.approvalStatus !== "PENDING") throw new ProposalNotPendingError();

  const mealInput = proposal.job.ingestionInput;
  if (!mealInput || mealInput.intent !== "MEAL" || !mealInput.meal || !mealInput.diaryDate) throw new Error("Proposal has no meal to log against");

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


  const outcome: AcceptedOutcome = {
    logged, estimated, skipped, skippedDetails,
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
