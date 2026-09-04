import type { MealType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { diaryDate } from "./diary";

/**
 * Placeholders for AI runs that have not produced their entry.
 *
 * A queued extraction used to be invisible everywhere except the page the
 * submission redirected to: navigate away while a local model spends minutes on
 * the input and the meal or the recipe simply is not there yet, with nothing
 * saying that it is on its way or where to look. So every list the run will
 * eventually write into carries a stand-in entry for it in the meantime.
 *
 * The stand-in is derived from the job, never stored: it exists exactly while
 * the job has not produced its result, and the moment the worker finishes, the
 * same query stops returning it and the real recipe or diary entry is there
 * instead. Nothing has to clean it up, and a crashed worker cannot leave a dummy
 * row behind in the user's own data.
 *
 * A run that failed is kept here too, and that is the point of `FAILED` being in
 * the list. When Ollama cannot be reached, every job in flight burns its retries
 * against a connection that is not there and ends as FAILED - and the stand-in
 * simply vanished from the list, so the submitted work looked silently
 * discarded: no entry, no error, nothing to retry. It now stays, says it
 * failed, and carries the button that queues it again.
 */

/** Job states an entry is still being worked on in. */
const IN_FLIGHT = ["QUEUED", "RUNNING"] as const;

/** The states with no entry to show yet: still working, or failed outright. */
export type AiPlaceholderStatus = (typeof IN_FLIGHT)[number] | "FAILED";

/**
 * How long a failed run keeps standing in for the entry it never produced.
 *
 * Long enough that a failure is still there to be found after a weekend away -
 * the whole reason it is shown at all - and bounded so that a list does not
 * collect months of dead runs nobody is going to retry. Re-running clears it
 * either way, and the admin queue keeps the full history regardless.
 */
export const FAILED_PLACEHOLDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The user-facing reading of `AiFailureKind`.
 *
 * The administrator's list distinguishes sixteen causes because the fix differs
 * for each. A user has exactly two questions - is this mine to fix, and is
 * re-running worth it - so the kinds are collapsed to the few answers that
 * differ, with `OTHER` covering everything a re-run is simply worth trying on.
 */
export const AI_PLACEHOLDER_REASONS = [
  "MODEL_UNREACHABLE",
  "MODEL_TIMEOUT",
  "MODEL_MISSING",
  "SOURCE_UNAVAILABLE",
  "OTHER",
] as const;

export type AiPlaceholderReason = (typeof AI_PLACEHOLDER_REASONS)[number];

export function placeholderReason(failureKind: string | null): AiPlaceholderReason {
  if (failureKind === "MODEL_UNREACHABLE" || failureKind === "MODEL_HTTP_ERROR") return "MODEL_UNREACHABLE";
  if (failureKind === "MODEL_TIMEOUT") return "MODEL_TIMEOUT";
  if (failureKind === "MODEL_MISSING" || failureKind === "MODEL_VISION_UNSUPPORTED") return "MODEL_MISSING";
  if (failureKind === "SOURCE_UNAVAILABLE" || failureKind === "SOURCE_BLOCKED" || failureKind === "SOURCE_TOO_LARGE")
    return "SOURCE_UNAVAILABLE";
  return "OTHER";
}

/**
 * Machine tokens the worker stores as its own message. They name the step that
 * failed rather than the problem, and each one already has a sentence in the
 * reason above, so showing them again would only be noise in a tooltip.
 */
const OPAQUE_MESSAGES = /^(source-|unsafe-source:|scan-|AI processing failed$)/;

/**
 * The run's own last error line, for the reader who wants more than the reason.
 *
 * The five reasons above answer "is this mine to fix"; they deliberately say
 * nothing about *what* went wrong, so a run that died on "Cannot resolve
 * portion: density-required" reads exactly like any other end in an error and
 * the one line that explains it is only in the admin queue. It is kept here so
 * the failed row can carry it, and dropped when it is a token the reason has
 * already said in words.
 */
export function placeholderDetail(errorMessage: string | null): string | undefined {
  const message = errorMessage?.trim();
  if (!message || OPAQUE_MESSAGES.test(message)) return undefined;
  // A tooltip, not a log: one line of it is what a person will read.
  return message.length > 200 ? `${message.slice(0, 199)}…` : message;
}

export interface AiPlaceholder {
  /** The AiJob id. Stable while the run lasts and gone once it produced its entry. */
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
  /** Why it failed, in the terms the submitter can act on. FAILED only. */
  reason?: AiPlaceholderReason;
  /**
   * The failure in the worker's own words, where they add something to the
   * reason. Shown on the row's failure tag rather than in the list itself: it
   * is a diagnostic line, sometimes untranslated, and the row is one line high.
   */
  detail?: string;
  /**
   * Whether running it again has anything to run on. A photo is deleted the
   * moment its job fails - it is the most private thing the input holds and
   * nothing will read it again - so an image-only submission cannot be repeated
   * and is not offered a button that would only fail a second time.
   */
  retryable?: boolean;
}

/** A one-line reminder of the submitted input, never the whole page or essay. */
function sourceLabel(text: string | null, sourceUrl: string | null) {
  return (text?.trim() || sourceUrl?.trim() || "").slice(0, 120);
}

/** Every unfinished run, with failures limited to the ones still worth showing. */
const unfinishedWhere = (userId: string) => ({
  userId,
  OR: [
    { status: { in: [...IN_FLIGHT] } },
    { status: "FAILED" as const, failedAt: { gt: new Date(Date.now() - FAILED_PLACEHOLDER_TTL_MS) } },
  ],
  entityType: "AI_INGESTION",
});

/**
 * How a failed run reads to its submitter: why it failed, and whether running it
 * again has anything to run on.
 *
 * A meal whose extraction is already cached restarts from that, so it is
 * runnable even once its image is gone; everything else needs the text, the URL
 * or the image bytes it was submitted with. `imageMime` is cleared in the same
 * write as the bytes, so it answers "is the image still there" without loading
 * megabytes of it.
 */
function failedFields(job: {
  status: string;
  failureKind: string | null;
  errorMessage: string | null;
  metadata: unknown;
  ingestionInput: { text: string | null; sourceUrl: string | null; imageMime: string | null } | null;
}) {
  if (job.status !== "FAILED") return {};
  const cached = Boolean((job.metadata as { extraction?: unknown } | null)?.extraction);
  const input = job.ingestionInput;
  return {
    reason: placeholderReason(job.failureKind),
    detail: placeholderDetail(job.errorMessage),
    retryable: cached || Boolean(input?.text?.trim() || input?.sourceUrl?.trim() || input?.imageMime),
  };
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
      ...unfinishedWhere(userId),
      ingestionInput: { intent: "MEAL", diaryDate: diaryDate(date) },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      entityId: true,
      metadata: true,
      failureKind: true,
      errorMessage: true,
      ingestionInput: { select: { text: true, sourceUrl: true, imageMime: true, meal: true } },
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
      ...failedFields(job),
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
      ...unfinishedWhere(userId),
      ingestionInput: { intent: "RECIPE" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      entityId: true,
      metadata: true,
      failureKind: true,
      errorMessage: true,
      ingestionInput: { select: { text: true, sourceUrl: true, imageMime: true, intent: true } },
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
        ...failedFields(job),
      }];
    }
    return [];
  });
}

/** True while any of these runs can still finish on its own. */
export const hasRunInFlight = (placeholders: AiPlaceholder[]) =>
  placeholders.some((placeholder) => placeholder.status !== "FAILED");
