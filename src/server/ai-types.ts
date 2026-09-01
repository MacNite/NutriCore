/**
 * Shapes and pure rules shared between the worker, the review page and the
 * approval action. They live outside the `"use server"` modules so a page can
 * import them without pulling a server action into its module graph.
 */

/**
 * One component of a meal as the model proposed it, after the worker has tried
 * to resolve it against the food database. `canonicalFoodId` is null when no
 * known food matched, which is the case that must never become a diary entry:
 * the model may name a food, but it is never a source of nutrition values.
 */
export interface ProposedComponent {
  name: string;
  quantity?: number;
  unit?: string;
  estimatedGrams?: number;
  preparation?: string;
  canonicalFoodId?: string | null;
  /**
   * True when `nutritionPer100g` came from the model rather than from a food in
   * the database. Such a component may still be approved, but only ever as a
   * clearly marked estimate.
   */
  estimated?: boolean;
  nutritionPer100g?: Record<string, number | null> | null;
  sources?: Array<{ title: string; url: string }>;
}

/** What approving a proposal actually did, recorded on `AiProposal.accepted`. */
export interface AcceptedOutcome {
  logged: string[];
  /** Logged from the model's own numbers, as an estimate. Subset of nothing else. */
  estimated?: string[];
  skipped: string[];
  acceptedAt: string;
}

/** A component whose nutrition the model stated itself, with a usable weight. */
export const isEstimatedComponent = (component: ProposedComponent) =>
  !component.canonicalFoodId &&
  component.estimated === true &&
  hasNutrition(component.nutritionPer100g) &&
  hasWeight(component);

const hasWeight = (component: ProposedComponent) =>
  typeof component.estimatedGrams === "number" && component.estimatedGrams > 0;

const hasNutrition = (values: ProposedComponent["nutritionPer100g"]) =>
  Boolean(values && Object.values(values).some((value) => typeof value === "number"));

/**
 * Splits a proposal into what may be logged and what may not.
 *
 * A component needs a weight and a source of nutrition. The source is a food the
 * user can see, or - failing that - numbers the model stated for it, which are
 * logged only as a marked estimate. What is never allowed is an entry with no
 * nutrition behind it at all: that would log as zero calories and silently
 * understate the day, which is worse than no entry.
 */
export function partitionComponents(components: ProposedComponent[]) {
  const loggable: ProposedComponent[] = [];
  const skipped: string[] = [];
  for (const component of components) {
    if ((component.canonicalFoodId && hasWeight(component)) || isEstimatedComponent(component)) loggable.push(component);
    else skipped.push(component.name);
  }
  return { loggable, skipped };
}

/**
 * Queue-management vocabulary for the admin panel. It lives here rather than in
 * `admin-actions.ts` because a `"use server"` module may only export async
 * functions, and both the action and the client panel need these values.
 */
export const AI_JOB_OPERATIONS = [
  "requeue",
  "cancel",
  "delete",
  "requeueAllFailed",
  "deleteCompleted",
  "deleteFailed",
  "unstickRunning",
] as const;

export type AiJobOperation = (typeof AI_JOB_OPERATIONS)[number];

/** Operations that act on the checked rows; the rest sweep a whole status. */
export const AI_JOB_SELECTION_OPERATIONS: readonly AiJobOperation[] = ["requeue", "cancel", "delete"];

/** Operations that destroy rows, so the panel asks before submitting them. */
export const AI_JOB_DESTRUCTIVE_OPERATIONS: readonly AiJobOperation[] = ["delete", "deleteCompleted", "deleteFailed"];

/**
 * A job claimed by a worker that then died stays RUNNING for ever: nothing in
 * the queue loop ever reclaims it. Anything older than this is treated as
 * abandoned rather than in progress.
 */
export const STUCK_RUNNING_MS = 30 * 60 * 1000;

export const AI_JOB_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;
export type AiJobStatusName = (typeof AI_JOB_STATUSES)[number];

/**
 * Higher runs first. Work a user is waiting for goes ahead of background
 * backfilling: a "Backfill missing nutrition" sweep can queue a whole batch, and
 * a strictly chronological queue put every quick meal behind all of it.
 *
 * The column defaults to the user-facing value, so a job type added later is
 * never accidentally starved - only background work opts down.
 */
export const jobPriority = (entityType: string) => (entityType === "FOOD_ENRICHMENT" ? 0 : 10);
