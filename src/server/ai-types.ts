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
/** Where a candidate's numbers came from, in descending order of trust. */
export type CandidateOrigin = "LOCAL" | "OPEN_FOOD_FACTS" | "WEB_EXTRACT";

/**
 * One food the resolver offers for a component.
 *
 * Offered rather than silently applied: Open Food Facts is a database of branded
 * products, so a generic word like "Brot" resolves to one specific supermarket
 * loaf. Which one has to be visible to the person approving the meal, and
 * changeable by them.
 */
export interface ComponentCandidate {
  foodId: string;
  name: string;
  brand: string | null;
  origin: CandidateOrigin;
  score: number;
  isEstimated: boolean;
  /** The page a web extraction read, so the numbers stay traceable. */
  url: string | null;
  /**
   * Grams for this component against *this* food. It belongs on the candidate,
   * not on the component: "2 Scheiben" is 60 g of a bread with a 30 g slice
   * serving and 50 g of one with a 25 g slice, so switching the choice in the
   * review screen has to switch the weight with it.
   */
  grams: number | null;
  gramsSource: GramsSource;
}

/**
 * Where the gram weight for a component came from, most factual first.
 * `SERVING` matched the food's own wording; `PORTION` used the food's serving
 * weight for a portion word it does not name; `MODEL` is the model's reading of
 * the sentence.
 */
export type GramsSource = "SERVING" | "PORTION" | "UNIT" | "MODEL" | "NONE";

export interface ResolvedComponent {
  candidates: ComponentCandidate[];
  /** Pre-selected only when the candidate's name plausibly matches. */
  selectedFoodId: string | null;
  grams: number | null;
  gramsSource: GramsSource;
}

export interface ProposedComponent {
  name: string;
  quantity?: number;
  unit?: string;
  estimatedGrams?: number;
  preparation?: string;
  canonicalFoodId?: string | null;
  /** What the resolver found, for the reviewer to choose from. */
  candidates?: ComponentCandidate[];
  /** Grams as resolved, preferring the food's own serving data. */
  grams?: number | null;
  gramsSource?: GramsSource;
  /**
   * True when `nutritionPer100g` came from the model rather than from a food in
   * the database. Such a component may still be approved, but only ever as a
   * clearly marked estimate.
   */
  estimated?: boolean;
  nutritionPer100g?: Record<string, number | null> | null;
  sources?: Array<{ title: string; url: string }>;
}

/**
 * What the quick-meal form asked for, read off `AiJob.metadata`.
 *
 * Both default to the behaviour that predates the checkboxes: a submission is
 * logged unless it said otherwise, and keeps a recipe only if it said so.
 */
export function quickMealOptions(metadata: unknown) {
  const value = (metadata ?? {}) as { addToMeal?: unknown; createRecipe?: unknown };
  return { addToMeal: value.addToMeal !== false, createRecipe: value.createRecipe === true };
}

/**
 * What a quick meal's recipe is called.
 *
 * The extraction names the dish the way the recipe import does, so a photo or a
 * "2 Scheiben Brot mit Butter und Marmelade" produces a recipe called
 * "Butterbrot mit Marmelade" rather than the sentence itself - or, for an input
 * that was only an image, nothing at all. The typed text stays the fallback for
 * a model that named nothing.
 */
export function quickMealRecipeName(generated: string | undefined, text: string) {
  return generated?.trim().slice(0, 200) || text.trim().slice(0, 120) || "Quick meal";
}

/** What approving a proposal actually did, recorded on `AiProposal.accepted`. */
export interface AcceptedOutcome {
  logged: string[];
  /** Logged from the model's own numbers, as an estimate. Subset of nothing else. */
  estimated?: string[];
  skipped: string[];
  /** Present on new outcomes; `skipped` remains for backwards compatibility. */
  skippedDetails?: SkippedComponent[];
  /**
   * The recipe the submitter asked to keep, built from what this approval
   * actually logged. Absent when none was asked for; `recipeSkipped` says that
   * one was asked for and nothing resolved to a food to put in it.
   */
  recipeId?: string;
  recipeName?: string;
  recipeSkipped?: boolean;
  acceptedAt: string;
}

export type SkipReason = "DECLINED" | "NO_FOOD" | "NO_WEIGHT" | "LOG_FAILED";
export interface SkippedComponent {
  name: string;
  reason: SkipReason;
}

/** A component whose nutrition the model stated itself, with a usable weight. */
export const isEstimatedComponent = (component: ProposedComponent) =>
  !component.canonicalFoodId &&
  component.estimated === true &&
  hasNutrition(component.nutritionPer100g) &&
  componentGrams(component) !== null;

const hasNutrition = (values: ProposedComponent["nutritionPer100g"]) =>
  Boolean(values && Object.values(values).some((value) => typeof value === "number"));

const positive = (value: number | null | undefined) =>
  typeof value === "number" && value > 0 ? value : null;

/**
 * The weight to log for a component, given the food finally chosen for it.
 *
 * The chosen candidate's own serving data wins, because a serving weight is a
 * fact about a food. The model's `estimatedGrams` is the fallback, because a
 * portion size is an interpretation of the sentence rather than a fact - and it
 * is the one number a nutrition source rarely carries.
 */
export function componentGrams(component: ProposedComponent, foodId?: string | null): number | null {
  const candidate = foodId ? component.candidates?.find((entry) => entry.foodId === foodId) : undefined;
  return positive(candidate?.grams) ?? positive(component.grams) ?? positive(component.estimatedGrams);
}

/** What approving a component actually does. */
export interface ComponentDecision {
  component: ProposedComponent;
  /** null means "log the model's own estimate", which needs its own food. */
  foodId: string | null;
  grams: number;
}

/** The reviewer's choices, beyond naming a food id outright. */
export const SKIP_CHOICE = "";
export const ESTIMATE_CHOICE = "estimate";

/**
 * Decides what a proposal logs, honouring the reviewer's choice per component.
 *
 * A component needs a weight and a source of nutrition. The source is the food
 * chosen for it - pre-selected by the resolver or picked in the review screen -
 * or, when nothing resolved, the numbers the model stated, logged only as a
 * marked estimate. What is never allowed is an entry with no nutrition behind it
 * at all: that logs as zero calories and silently understates the day, which is
 * worse than no entry.
 *
 * `selection` returns a food id, `ESTIMATE_CHOICE` to accept the model's own
 * numbers, `SKIP_CHOICE` to leave the component out, or undefined to let the
 * resolver's own choice stand.
 */
export function decideComponents(
  components: ProposedComponent[],
  selection: (index: number) => string | null | undefined = () => undefined,
) {
  const loggable: ComponentDecision[] = [];
  const skipped: string[] = [];
  const skippedDetails: SkippedComponent[] = [];

  const skip = (component: ProposedComponent, reason: SkipReason) => {
    skipped.push(component.name);
    skippedDetails.push({ name: component.name, reason });
  };

  components.forEach((component, index) => {
    const picked = selection(index);

    // An explicit decline is final: it never falls back to an estimate.
    if (picked === SKIP_CHOICE) {
      skip(component, "DECLINED");
      return;
    }

    const wantsEstimate = picked === ESTIMATE_CHOICE || (picked === undefined && !component.canonicalFoodId);
    const foodId = wantsEstimate ? null : (picked ?? component.canonicalFoodId ?? null);
    const grams = componentGrams(component, foodId);

    if (grams === null) {
      skip(component, "NO_WEIGHT");
      return;
    }
    if (foodId) {
      loggable.push({ component, foodId, grams });
      return;
    }
    // Only the model's own numbers are left, and only if it actually gave any.
    if (isEstimatedComponent(component)) {
      loggable.push({ component, foodId: null, grams });
      return;
    }
    skip(component, "NO_FOOD");
  });

  return { loggable, skipped, skippedDetails };
}

/**
 * What a finished job produced, recorded on `AiJob.metadata.outcome`.
 *
 * A failed job says why in `failureKind`; a successful one used to say nothing
 * at all, so "COMPLETED" gave no way to tell an enrichment that filled eight
 * nutrients from one that found nothing. Only small, already-public facts are
 * kept here - names and counts - because the metadata column is read straight
 * into the admin table.
 */
export interface AiJobOutcome {
  /** Nutrient keys an enrichment actually wrote, and whether it set a serving. */
  nutrientKeys?: string[];
  servingFilled?: boolean;
  /** A recipe the job created, draft or otherwise. */
  recipeId?: string;
  recipeName?: string;
  /** Ingredients a recipe extraction matched, and the ones it could not. */
  ingredientCount?: number;
  unmatched?: string[];
  /** The dish a research run ended up proposing. */
  candidateName?: string;
}

/** Reads the outcome back out of the untyped metadata column. */
export function jobOutcome(metadata: unknown): AiJobOutcome | null {
  const outcome = (metadata as { outcome?: unknown } | null)?.outcome;
  return outcome && typeof outcome === "object" ? (outcome as AiJobOutcome) : null;
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
