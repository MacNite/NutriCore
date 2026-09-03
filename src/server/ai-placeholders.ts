import type { MealType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { diaryDate } from "./diary";

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
      entityType: "AI_INGESTION",
      ingestionInput: { intent: "MEAL", diaryDate: diaryDate(date) },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      entityId: true,
      metadata: true,
      ingestionInput: { select: { text: true, sourceUrl: true, meal: true } },
    },
  });

  return jobs.flatMap((job) => {
    if (!job.ingestionInput) return [];
    return [{
      id: job.id,
      status: job.status as AiPlaceholderStatus,
      href: `/ai-review/${job.entityId}`,
      source: sourceLabel(job.ingestionInput.text, job.ingestionInput.sourceUrl),
      meal: job.ingestionInput.meal ?? undefined,
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
      entityType: "AI_INGESTION",
      ingestionInput: { intent: "RECIPE" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      entityId: true,
      metadata: true,
      ingestionInput: { select: { text: true, sourceUrl: true, intent: true } },
    },
  });

  return jobs.flatMap((job) => {
    if (job.ingestionInput?.intent === "RECIPE") {
      const input = job.ingestionInput;
      return [{
        id: job.id,
        status: job.status as AiPlaceholderStatus,
        // The import has no meal input, so `/ai-review` cannot describe it; its
        // own page is where this run reports progress and fills the form in.
        href: `/recipes/new?import=${job.entityId}`,
        source: sourceLabel(input.text, input.sourceUrl),
      }];
    }
    return [];
  });
}
