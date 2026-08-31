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
  sources?: Array<{ title: string; url: string }>;
}

/** What approving a proposal actually did, recorded on `AiProposal.accepted`. */
export interface AcceptedOutcome {
  logged: string[];
  skipped: string[];
  acceptedAt: string;
}

/**
 * Splits a proposal into what may be logged and what may not. A component is
 * only loggable once the worker has matched it to a food the user can see AND
 * the model gave it a weight: without either, the entry would have to invent
 * nutrition, which NutriCore never does.
 */
export function partitionComponents(components: ProposedComponent[]) {
  const loggable: ProposedComponent[] = [];
  const skipped: string[] = [];
  for (const component of components) {
    if (component.canonicalFoodId && component.estimatedGrams && component.estimatedGrams > 0) loggable.push(component);
    else skipped.push(component.name);
  }
  return { loggable, skipped };
}
