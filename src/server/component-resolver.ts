import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { hasAnyNutrient } from "@/lib/research";
import { normalizeName } from "@/lib/units";
import type { Locale } from "@/i18n/locales";
import { OllamaProvider } from "@/providers/ollama";
import { SearxngClient } from "@/providers/searxng";
import { searchFoods, toFoodResult, type FoodResult } from "./foods";
import { extractNutritionForName } from "./food-enrichment";
import type { ComponentCandidate, GramsSource, ProposedComponent, ResolvedComponent } from "./ai-types";

/**
 * Turns a component name the model produced into real, sourced nutrition.
 *
 * This is the step the quick-meal worker was missing. It used to look for a food
 * whose normalised name was *exactly equal* to the component name and, failing
 * that, ask SearXNG for links it never opened - so on a database without a row
 * literally called "Brot", nothing about "2 Scheiben Brot" was ever loggable.
 *
 * The chain is local, then Open Food Facts, then the open web, and it stops at
 * the first step that yields nutrition:
 *
 *   1. `searchFoods` - already the local-first pipeline used by food search. It
 *      matches on substrings, brands and aliases rather than exact equality, and
 *      when nothing local is convincing it queries Open Food Facts and writes
 *      the result back as a real Food row with provenance.
 *   2. The open web, gated on consent: SearXNG finds a page, the model reads the
 *      values off it, and a Food is created carrying that URL.
 *
 * What it never does is ask the model what a food contains. Candidates are
 * offered rather than silently chosen: Open Food Facts is a database of branded
 * products, so "Brot" resolves to some specific supermarket loaf, and which one
 * has to be visible and changeable by the person approving it.
 */

/** Enough of the catalogue to be worth logging; asked of a web extraction. */
const CORE_NUTRIENT_KEYS = [
  "energyKcal",
  "protein",
  "carbohydrate",
  "fat",
  "saturatedFat",
  "sugar",
  "fiber",
  "salt",
] as const;

/** How many choices to carry into the review screen. */
const MAX_CANDIDATES = 3;

/** Units that already are a weight or a volume, so no serving lookup is needed. */
const GRAM_UNITS = new Set(["g", "gr", "gramm", "gram", "grams"]);
const ML_UNITS = new Set(["ml", "milliliter", "millilitre"]);

/**
 * Words that measure out some of an ingredient rather than count portions of it.
 *
 * The distinction matters for the fallback below: a food's serving weight is a
 * fair answer for "2 Scheiben" or "1 Stück", and no answer at all for "1 EL" -
 * a level spoon holds what it holds whatever the packet's serving happens to be.
 *
 * Spelt as `normalizeName` writes them, which is diacritic-free: "Esslöffel"
 * arrives here as "essloffel", so that is the spelling this set must carry.
 */
const MEASURE_WORDS = new Set([
  "el", "essloffel", "essloffeln", "tbsp", "tablespoon", "tablespoons",
  "tl", "teeloffel", "teeloffeln", "tsp", "teaspoon", "teaspoons",
  "msp", "messerspitze", "messerspitzen", "prise", "prisen", "pinch", "dash",
  "handvoll", "handful", "handfuls", "cup", "cups", "tasse", "tassen",
  "schuss", "spritzer", "tropfen", "drop", "drops",
]);

const originOf = (food: FoodResult): ComponentCandidate["origin"] =>
  food.sourceType === "OPEN_FOOD_FACTS" ? "OPEN_FOOD_FACTS" : food.sourceType === "AI_RESEARCH" ? "WEB_EXTRACT" : "LOCAL";

/** Shortest word for which a prefix match is safe rather than a coincidence. */
const PREFIX_MATCH_MIN = 4;

/**
 * Nobody eats five kilograms of anything in one diary entry, so a weight past
 * this is a misread unit rather than a portion - "250 Stück" against a 30 g
 * serving would otherwise log 7.5 kg. Such a result is discarded and the
 * model's own reading is used instead.
 */
const MAX_PLAUSIBLE_GRAMS = 5000;

/**
 * Whether the unit the model wrote and a serving's own wording are the same word.
 *
 * German plurals are the whole point: the model writes "2 Scheiben" while the
 * food carries a "Scheibe" serving, and an exact comparison would miss it. The
 * prefix rule runs in both directions but only for words long enough that a
 * shared opening is not a coincidence - without the length floor, a unit of
 * "Eis" would match a serving labelled "Ei".
 */
function sameUnitWord(wantedNormalized: string, candidate: string) {
  const other = normalizeName(candidate);
  if (!wantedNormalized || !other) return false;
  if (wantedNormalized === other) return true;
  if (Math.min(wantedNormalized.length, other.length) < PREFIX_MATCH_MIN) return false;
  return wantedNormalized.startsWith(other) || other.startsWith(wantedNormalized);
}

/**
 * Grams for one component, preferring what the resolved food actually knows.
 *
 * A weight or a volume needs no lookup. A portion word ("Scheibe", "Stück")
 * needs the food's own serving data, and only when neither exists does the
 * model's guess stand - which is the right order, because a portion size is an
 * interpretation of the sentence while a serving weight is a fact about a food.
 *
 * `allowModelWeight` is about the weight and nothing else. It is not the flag
 * that decides whether the model may supply *nutrition*: a gram figure for a
 * food whose values come from a real source is still a sourced ingredient, and
 * refusing it only means the ingredient cannot be used at all.
 */
export function resolveGrams(
  component: Pick<ProposedComponent, "quantity" | "unit" | "estimatedGrams">,
  food: Pick<FoodResult, "servingSize" | "servingUnit" | "servings" | "densityGPerMl"> | null,
  allowModelWeight = true,
): { grams: number | null; source: GramsSource } {
  const unit = component.unit?.trim().toLowerCase() ?? "";
  const quantity = component.quantity;

  // Tried in order of how much the answer is a fact rather than a reading, and
  // the first plausible one wins. An implausible result falls through instead of
  // stopping the search, so a misread unit still ends up with the model's weight.
  for (const attempt of weightAttempts(allowModelWeight ? component : { ...component, estimatedGrams: undefined }, food, unit, quantity)) {
    if (attempt.grams > 0 && attempt.grams <= MAX_PLAUSIBLE_GRAMS) return attempt;
  }
  return { grams: null, source: "NONE" };
}

function* weightAttempts(
  component: Pick<ProposedComponent, "estimatedGrams">,
  food: Pick<FoodResult, "servingSize" | "servingUnit" | "servings" | "densityGPerMl"> | null,
  unit: string,
  quantity: number | undefined,
): Generator<{ grams: number; source: GramsSource }> {
  if (quantity && quantity > 0) {
    // A stated weight or volume needs no lookup at all.
    if (GRAM_UNITS.has(unit)) yield { grams: quantity, source: "UNIT" };
    else if (ML_UNITS.has(unit)) yield { grams: quantity * (food?.densityGPerMl ?? 1), source: "UNIT" };
    else if (food && unit) {
      const wanted = normalizeName(unit);

      // A serving whose label or unit is the word the model used: "2 Scheiben"
      // against a "Scheibe" serving of 30 g is 60 g of that food.
      const named = food.servings.find(
        (entry) =>
          Boolean(entry.gramEquivalent) &&
          (sameUnitWord(wanted, entry.label) || sameUnitWord(wanted, entry.unit)),
      );
      if (named?.gramEquivalent) yield { grams: quantity * named.gramEquivalent, source: "SERVING" };

      if (food.servingSize && food.servingUnit && sameUnitWord(wanted, food.servingUnit))
        yield { grams: quantity * food.servingSize, source: "SERVING" };

      /**
       * The unit is neither a weight nor a volume, so it is a count of portions -
       * and the food knows what one portion weighs even when it calls it
       * something else. Open Food Facts labels its serving after the amount
       * ("30 g"), never "Scheibe", so requiring the words to match meant "2
       * Scheiben Brot" resolved to no weight at all and could not be logged.
       *
       * A measure word is excluded, because it is not a portion of this food at
       * all: a spoon of flour and a spoon of salt weigh different amounts, and
       * neither is the flour's serving size. Reading "1 EL" as one whole
       * Open Food Facts serving of 125 g is not a conversion, so those fall
       * through to the model's reading of the measure instead.
       */
      if (!MEASURE_WORDS.has(wanted)) {
        const anyServing = food.servings.find((entry) => entry.gramEquivalent)?.gramEquivalent ?? food.servingSize;
        if (anyServing) yield { grams: quantity * anyServing, source: "PORTION" };
      }
    }
  }

  if (component.estimatedGrams) yield { grams: component.estimatedGrams, source: "MODEL" };
}

/**
 * True when a candidate is plausibly the food the component named, rather than
 * merely the best of a bad set. Used to decide whether to pre-select it.
 */
/**
 * Words that change a food into an accessory or substitute rather than merely
 * describing it. A substring match cannot distinguish "Rührei" from "Rührei
 * Gewürz", but automatically logging the latter is substantially worse than
 * leaving the component unresolved. The list is deliberately narrow: ordinary
 * descriptors such as "Bio" or "Vollkorn" remain eligible.
 */
const IDENTITY_CHANGING_WORDS = [
  "gewurz",
  "seasoning",
  "spice",
  "sauce",
  "dressing",
  "pulver",
  "powder",
  "aroma",
  "flavour",
  "flavor",
  "mischung",
  "mix",
  "extrakt",
  "extract",
  "sirup",
  "syrup",
  "ersatz",
  "substitute",
] as const;

const identityChanging = (token: string) => IDENTITY_CHANGING_WORDS.some((word) => token.startsWith(word));

export function isSafeAutomaticMatch(componentName: string, candidateName: string) {
  const wanted = normalizeName(componentName);
  const found = normalizeName(candidateName);
  if (!wanted || !found) return false;
  if (found === wanted) return true;
  if (!found.includes(wanted) && !wanted.includes(found)) return false;

  const wantedTokens = new Set(wanted.split(" "));
  const extraCandidateTokens = found.split(" ").filter((token) => !wantedTokens.has(token));
  return !extraCandidateTokens.some(identityChanging);
}

/**
 * Each candidate carries the weight it would give the component, not just a name.
 *
 * The model's own reading of a household measure is always allowed here, even
 * where model *nutrition* is forbidden: the nutrition comes from this food, and
 * only the weight is the model's. `gramsSource` records that, so the review
 * screen can show which weights are worth checking.
 */
const toCandidate = (food: FoodResult, component: ProposedComponent): ComponentCandidate => {
  const { grams, source } = resolveGrams(component, food);
  return {
    foodId: food.id,
    name: food.name,
    brand: food.brand,
    origin: originOf(food),
    score: Math.round(food.score),
    isEstimated: food.isEstimated,
    url: null,
    grams,
    gramsSource: source,
  };
};

export interface ResolverContext {
  userId: string;
  locale: Locale;
  /** Whether this user has consented to fetching pages from the open web. */
  webSourcesAllowed: boolean;
  /**
   * Whether an unresolved component may fall back to nutrition stated by the
   * extraction model. It governs nutrition only: the weight a *resolved* food
   * gets for a household measure is always the model's to supply, because
   * nothing else in the chain knows what a spoonful weighs.
   */
  allowModelEstimates: boolean;
  deps?: { ai?: OllamaProvider; search?: SearxngClient };
}

export async function resolveComponent(
  component: ProposedComponent,
  context: ResolverContext,
): Promise<ResolvedComponent> {
  const candidates: ComponentCandidate[] = [];

  // Step 1: the local-first pipeline, which reaches Open Food Facts on its own
  // when nothing local is convincing, and caches what it finds.
  try {
    const outcome = await searchFoods({
      userId: context.userId,
      query: component.name,
      locale: context.locale,
      includeRemote: true,
      limit: MAX_CANDIDATES * 3,
    });
    // A food with no nutrition at all cannot be logged, however well it matches.
    for (const food of outcome.results) {
      if (!hasAnyNutrient(food.nutrients)) continue;
      candidates.push(toCandidate(food, component));
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  } catch (error) {
    // A provider outage degrades the proposal; it never fails the whole meal.
    logger.warn("Component lookup failed", {
      component: component.name,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  // Step 2: the open web, only with consent and only when nothing was found.
  if (!candidates.length && context.webSourcesAllowed) {
    const web = await resolveFromWeb(component, context);
    if (web) candidates.push(web);
  }

  // The provider's first result may be an accessory whose name merely contains
  // the food ("Rührei Gewürz"). Pick the first identity-safe candidate instead;
  // if none qualifies, keep all suggestions visible but auto-select nothing.
  const chosen = candidates.find((candidate) => isSafeAutomaticMatch(component.name, candidate.name));
  const selectedFoodId = chosen?.foodId ?? null;
  // The component-level weight is the one that applies when no food is chosen,
  // so it is the model's own reading of the sentence and nothing else.
  const { grams, source } = context.allowModelEstimates ? resolveGrams(component, null) : { grams: null, source: "NONE" as const };

  return { candidates, selectedFoodId, grams, gramsSource: source };
}

/**
 * Creates a food from values read off a web page.
 *
 * `sourceType: AI_RESEARCH` and `isEstimated` are deliberate: a page a search
 * engine happened to rank first is weaker evidence than Open Food Facts, and
 * ranking has to keep treating it that way. The URL is stored on the source row,
 * so every number stays traceable to the page it came from.
 */
async function resolveFromWeb(component: ProposedComponent, context: ResolverContext) {
  const name = component.name;
  let extracted;
  try {
    extracted = await extractNutritionForName(name, CORE_NUTRIENT_KEYS, context.deps);
  } catch (error) {
    logger.warn("Web extraction for a component failed", {
      component: name,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
  if (!extracted || !hasAnyNutrient(extracted.per100g)) return null;

  const created = await prisma.food.create({
    data: {
      ownerId: context.userId,
      name,
      normalizedName: normalizeName(name),
      locale: context.locale,
      sourceType: "AI_RESEARCH",
      foodType: "GENERIC",
      basisAmount: 100,
      basisUnit: "G",
      isEstimated: true,
      servingSize: extracted.servingSizeG ?? null,
      servingUnit: extracted.servingSizeG ? "g" : null,
      nutrients: {
        createMany: { data: Object.entries(extracted.per100g).map(([nutrientKey, value]) => ({ nutrientKey, value })) },
      },
      sources: {
        create: [
          {
            provider: "AI_WEB_EXTRACT",
            retrievedAt: new Date(),
            url: extracted.url,
            model: extracted.model,
            estimated: true,
            metadata: { sourceUrls: extracted.consideredUrls, nutrientKeys: Object.keys(extracted.per100g) },
          },
        ],
      },
    },
    include: {
      nutrients: { select: { nutrientKey: true, value: true } },
      servings: { select: { label: true, amount: true, unit: true, gramEquivalent: true, mlEquivalent: true } },
    },
  });

  const food = toFoodResult(created, 0, false);
  // `originOf` already reads AI_RESEARCH as a web extract; the URL is what the
  // review screen needs in order to show where the numbers came from.
  return { ...toCandidate(food, component), url: extracted.url };
}
