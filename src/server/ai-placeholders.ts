import type { MealType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { diaryDate } from "./diary";
import { quickMealOptions } from "./ai-types";

/**
 * Placeholders for AI runs that are still going.
 *
 * A queued extraction used to be invisible everywhere except the page the
 * submission redirected to: navigate away while a local model spends minutes on
 * the input and the meal or the recipe simply is not there yet, with nothing
 * saying that it is on its way or where to look. So every list the run will
 * eventually write into carries a stand-in entry for it in the meantime.
 *
 * The stand-in is derived from the job, never stored: it exists exactly while
 * the job is QUEUED or RUNNING, and the moment the worker finishes, the same
 * query stops returning it and the real recipe or diary entry is there instead.
 * Nothing has to clean it up, and a crashed worker cannot leave a dummy row
 * behind in the user's own data.
 */

/** Job states an entry is still being worked on in. */
const IN_FLIGHT = ["QUEUED", "RUNNING"] as const;

export type AiPlaceholderStatus = (typeof IN_FLIGHT)[number];

export interface AiPlaceholder {
  /** The AiJob id. Stable while the run lasts and gone once it ends. */
  id: string;
  status: AiPlaceholderStatus;
  /**
   * Where following the entry leads: the review page for this run, which is the
   * only thing the placeholder is for. Quick meals have `/ai-review/[id]`, keyed
   * on the meal input; a recipe import has its own progress page instead, since
   * no meal input - and so no AI review - exists for it.
   */
  href: string;
  /** What was submitted, so two runs at once stay tellable apart. */
  source: string;
  /** Which meal it will be written into. Meal placeholders only. */
  meal?: MealType;
}

/** A one-line reminder of the submitted input, never the whole page or essay. */
function sourceLabel(text: string | null, sourceUrl: string | null) {
  return (text?.trim() || sourceUrl?.trim() || "").slice(0, 120);
}

/**
 * Runs that will write into this day's diary, one placeholder per meal.
 *
 * A submission that asked not to be logged is left out: it is never going to
 * appear in a meal, so promising it there would be a stand-in for nothing.
 */
export async function mealPlaceholders(userId: string, date: string): Promise<AiPlaceholder[]> {
  const jobs = await prisma.aiJob.findMany({
    where: {
      userId,
      status: { in: [...IN_FLIGHT] },
      entityType: "MEAL_INPUT",
      mealInput: { diaryDate: diaryDate(date) },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      entityId: true,
      metadata: true,
      mealInput: { select: { text: true, sourceUrl: true, meal: true } },
    },
  });

  return jobs.flatMap((job) => {
    if (!job.mealInput || !quickMealOptions(job.metadata).addToMeal) return [];
    return [{
      id: job.id,
      status: job.status as AiPlaceholderStatus,
      href: `/ai-review/${job.entityId}`,
      source: sourceLabel(job.mealInput.text, job.mealInput.sourceUrl),
      meal: job.mealInput.meal,
    }];
  });
}

/**
 * Runs that will end up as a recipe: an import, and a quick meal the submitter
 * asked to keep. Newest first, the order the recipe list itself uses.
 */
export async function recipePlaceholders(userId: string): Promise<AiPlaceholder[]> {
  const jobs = await prisma.aiJob.findMany({
    where: {
      userId,
      status: { in: [...IN_FLIGHT] },
      entityType: { in: ["MEAL_INPUT", "RECIPE_IMPORT"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      entityType: true,
      entityId: true,
      metadata: true,
      mealInput: { select: { text: true, sourceUrl: true } },
    },
  });

  const imports = jobs.filter((job) => job.entityType === "RECIPE_IMPORT");
  // Scoped to the owner as well as to the ids: the job is this user's, and the
  // import it names has to be too before any of its text is shown back.
  const inputs = imports.length
    ? await prisma.recipeImport.findMany({
        where: { id: { in: imports.map((job) => job.entityId) }, userId },
        select: { id: true, text: true, sourceUrl: true },
      })
    : [];
  const byId = new Map(inputs.map((input) => [input.id, input]));

  return jobs.flatMap((job) => {
    if (job.entityType === "RECIPE_IMPORT") {
      const input = byId.get(job.entityId);
      if (!input) return [];
      return [{
        id: job.id,
        status: job.status as AiPlaceholderStatus,
        // The import has no meal input, so `/ai-review` cannot describe it; its
        // own page is where this run reports progress and fills the form in.
        href: `/recipes/new?import=${job.entityId}`,
        source: sourceLabel(input.text, input.sourceUrl),
      }];
    }
    if (!job.mealInput || !quickMealOptions(job.metadata).createRecipe) return [];
    return [{
      id: job.id,
      status: job.status as AiPlaceholderStatus,
      href: `/ai-review/${job.entityId}`,
      source: sourceLabel(job.mealInput.text, job.mealInput.sourceUrl),
    }];
  });
}
