export interface RankSignals {
  barcodeMatch?: boolean;
  exactNameMatch?: boolean;
  textMatch: number;
  brandMatch?: boolean;
  localeMatch?: boolean;
  favorite?: boolean;
  daysSinceUse?: number;
  usageFrequency?: number;
  sameMealContext?: boolean;
  personalRecipe?: boolean;
  customFood?: boolean;
  /**
   * Set when the list is being browsed rather than searched - the recent
   * foods, which carry no query. Signals that scale with how well a name
   * matches have nothing to scale by, and apply in full.
   */
  browsing?: boolean;
  dataCompleteness: number;
  sourceTrust: number;
  servingAvailability?: boolean;
  aiConfidence?: number;
  isAI?: boolean;
}

/** A barcode hit is an identity match, so it outranks every scored result. */
export const BARCODE_SCORE = 1_000_000;

/**
 * Deterministic ranking. No model, no training data - just weighted signals, so
 * the same query always produces the same order.
 */
export function rankFood(s: RankSignals) {
  if (s.barcodeMatch) return BARCODE_SCORE;

  let score = s.textMatch * 300 + s.dataCompleteness * 60 + s.sourceTrust * 100;
  if (s.exactNameMatch) score += 500;
  if (s.brandMatch) score += 80;
  if (s.localeMatch) score += 25;
  if (s.favorite) score += 180;
  // Recency decays smoothly; a food used today beats one used last month.
  if (s.daysSinceUse !== undefined) score += 100 * Math.exp(-s.daysSinceUse / 14);
  // Logarithmic so a food logged 200 times cannot dominate the whole list.
  score += Math.log1p(s.usageFrequency ?? 0) * 30;
  if (s.sameMealContext) score += 25;
  // "It's mine" settles a tie between comparable matches; it does not license
  // a worse one. A recipe that merely mentions the queried word gets the same
  // share of the bonus as its name match, so "Rote Zwiebel Salsa" no longer
  // outranks the onion for "Zwiebel" - while the same recipe, searched for by
  // its own name, still gets all of it.
  const ownName = s.browsing || s.exactNameMatch ? 1 : s.textMatch;
  if (s.personalRecipe || s.customFood) score += 90 * ownName;
  if (s.servingAvailability) score += 15;
  // An AI estimate always carries a penalty, scaled by how unsure it is.
  if (s.isAI) score -= 250 + (1 - (s.aiConfidence ?? 0)) * 200;
  return score;
}

/**
 * Relative trust per source, feeding the `sourceTrust` signal.
 *
 * This orders candidates that have already been found. It does NOT decide
 * which source is asked - that is the tier order in
 * src/providers/food-sources.ts - and it is deliberately too small a term to
 * override an identity match: a barcode hit short-circuits ranking entirely,
 * and an exact name is worth 500 points against the 100 the whole trust scale
 * spans. A better-trusted generic food can therefore never displace the
 * branded product the user actually scanned.
 *
 * BLS and a user's own food are equally trusted: one is the German national
 * nutrient database, the other is what this person measured themselves.
 */
export const SOURCE_TRUST: Record<string, number> = {
  USER: 0.95,
  BLS: 0.95,
  USDA: 0.92,
  RECIPE: 0.9,
  FATSECRET: 0.9,
  OPEN_FOOD_FACTS: 0.85,
  IMPORTED: 0.6,
  AI_RESEARCH: 0.25,
};

/**
 * How well one query token is answered by one candidate token.
 *
 * German writes compounds as one word, so the token the user typed is very
 * often only a part of the token the database stores, and which part decides
 * what the food is. German compounds are head-final: a "Speisezwiebel" is a
 * Zwiebel, while a "Zwiebelsuppe" is a soup. A suffix hit is therefore worth
 * nearly as much as the whole word, and a prefix hit - a half-typed word, or
 * a different food that merely starts the same way - much less. The one
 * exception is a prefix a character or two short of the whole token, which is
 * a plural rather than another word.
 *
 * A substring shorter than `MIN_PARTIAL_TOKEN` is noise rather than a word, so
 * only whole-token and prefix hits are considered below that length.
 */
const EXACT_TOKEN = 1;
const INFLECTED_TOKEN = 0.95;
const COMPOUND_HEAD = 0.9;
const TOKEN_PREFIX = 0.6;
const TOKEN_INSIDE = 0.45;
/** Two more characters is a plural ("Zwiebeln"), not a different word. */
const MAX_INFLECTION = 2;
const MIN_PARTIAL_TOKEN = 4;

function tokenWeight(token: string, other: string): number {
  if (token === other) return EXACT_TOKEN;
  if (other.startsWith(token) && other.length - token.length <= MAX_INFLECTION) return INFLECTED_TOKEN;
  if (token.length >= MIN_PARTIAL_TOKEN && other.endsWith(token)) return COMPOUND_HEAD;
  if (other.startsWith(token)) return TOKEN_PREFIX;
  if (token.length < MIN_PARTIAL_TOKEN) return 0;
  return other.includes(token) ? TOKEN_INSIDE : 0;
}

/**
 * How well a candidate name answers a query, in [0,1]. Cheap, deterministic
 * and good enough to order candidates that Postgres already narrowed down.
 *
 * Two things are measured, because either on its own ranks a German food
 * database badly:
 *
 *   *Recall* - how much of the query the name accounts for, per `tokenWeight`.
 *
 *   *Precision* - how much of the name the query accounts for, counted in
 *   characters so a trailing qualifier ("roh", "gekocht") costs far less than
 *   a whole extra ingredient.
 *
 * Precision is the half that used to be missing, and its absence is what put
 * a user's "Rote Zwiebel Salsa" above every BLS onion for the query
 * "Zwiebel": a name containing the query token scored a perfect 1, so a dish
 * that merely mentions an ingredient tied - and then won on the bonus its
 * owner gets - against the food that *is* that ingredient. Recall alone had
 * the mirror flaw: "Speisezwiebel roh" scored 0, because nothing in it starts
 * with "Zwiebel".
 */
export function textSimilarity(query: string, candidate: string) {
  const q = query.trim().toLowerCase();
  const c = candidate.trim().toLowerCase();
  if (!q || !c) return 0;
  if (q === c) return 1;

  const queryTokens = q.split(/\s+/).filter(Boolean);
  const candidateTokens = c.split(/\s+/).filter(Boolean);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  const answered = new Set<number>();
  let matched = 0;
  for (const token of queryTokens) {
    let best = 0;
    let bestIndex = -1;
    candidateTokens.forEach((other, index) => {
      const weight = tokenWeight(token, other);
      if (weight > best) {
        best = weight;
        bestIndex = index;
      }
    });
    matched += best;
    if (bestIndex >= 0) answered.add(bestIndex);
  }

  const recall = matched / queryTokens.length;
  const totalChars = candidateTokens.reduce((sum, token) => sum + token.length, 0);
  const answeredChars = [...answered].reduce((sum, index) => sum + candidateTokens[index].length, 0);
  const precision = answeredChars / totalChars;
  return recall * precision;
}

/** Share of the primary nutrients that actually carry a value. */
export function completeness(nutrients: Record<string, number | null>) {
  const keys = ["energyKcal", "protein", "carbohydrate", "fat"];
  const known = keys.filter((key) => nutrients[key] != null).length;
  return known / keys.length;
}
