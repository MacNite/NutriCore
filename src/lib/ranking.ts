export interface RankSignals {
  barcodeMatch?: boolean;
  exactNameMatch?: boolean;
  textMatch: number;
  brandMatch?: boolean;
  localeMatch?: boolean;
  /** The product is sold in the market this instance serves. */
  marketMatch?: boolean;
  favorite?: boolean;
  daysSinceUse?: number;
  usageFrequency?: number;
  sameMealContext?: boolean;
  personalRecipe?: boolean;
  customFood?: boolean;
  dataCompleteness: number;
  sourceTrust: number;
  servingAvailability?: boolean;
  aiConfidence?: number;
  isAI?: boolean;
}

/**
 * The market this instance serves, as Open Food Facts country tags. Search
 * prefers products sold here; it never restricts results to them, because the
 * tags are crowdsourced and a missing one would otherwise hide a real product.
 */
export const MARKET_COUNTRIES = ["en:germany"];

export const inMarket = (countries: string[]) => countries.some((tag) => MARKET_COUNTRIES.includes(tag));

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
  // Enough to lift a German product above an equally good foreign one, and
  // well short of overturning a better name match. Products Open Food Facts
  // has no country tag for are simply not boosted, never demoted.
  if (s.marketMatch) score += 120;
  if (s.favorite) score += 180;
  // Recency decays smoothly; a food used today beats one used last month.
  if (s.daysSinceUse !== undefined) score += 100 * Math.exp(-s.daysSinceUse / 14);
  // Logarithmic so a food logged 200 times cannot dominate the whole list.
  score += Math.log1p(s.usageFrequency ?? 0) * 30;
  if (s.sameMealContext) score += 25;
  if (s.personalRecipe || s.customFood) score += 90;
  if (s.servingAvailability) score += 15;
  // An AI estimate always carries a penalty, scaled by how unsure it is.
  if (s.isAI) score -= 250 + (1 - (s.aiConfidence ?? 0)) * 200;
  return score;
}

/** Relative trust per source, feeding the `sourceTrust` signal. */
export const SOURCE_TRUST: Record<string, number> = {
  USER: 0.95,
  RECIPE: 0.9,
  OPEN_FOOD_FACTS: 0.85,
  USDA: 0.9,
  IMPORTED: 0.6,
  AI_RESEARCH: 0.25,
};

/**
 * Token-overlap similarity in [0,1]. Cheap, deterministic and good enough to
 * order candidates that Postgres already narrowed down.
 */
export function textSimilarity(query: string, candidate: string) {
  const q = query.trim().toLowerCase();
  const c = candidate.trim().toLowerCase();
  if (!q || !c) return 0;
  if (q === c) return 1;

  const queryTokens = q.split(/\s+/).filter(Boolean);
  const candidateTokens = new Set(c.split(/\s+/).filter(Boolean));
  if (queryTokens.length === 0) return 0;

  let matched = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) matched += 1;
    else if ([...candidateTokens].some((other) => other.startsWith(token))) matched += 0.6;
  }
  const overlap = matched / queryTokens.length;
  // A prefix hit on the whole string is a strong signal for short queries.
  return c.startsWith(q) ? Math.max(overlap, 0.8) : overlap;
}

/** Share of the primary nutrients that actually carry a value. */
export function completeness(nutrients: Record<string, number | null>) {
  const keys = ["energyKcal", "protein", "carbohydrate", "fat"];
  const known = keys.filter((key) => nutrients[key] != null).length;
  return known / keys.length;
}
