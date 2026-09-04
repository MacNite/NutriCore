/**
 * When a search has found enough, and may stop asking further sources.
 *
 * This is the one decision that makes a tier order more than a preference: it
 * is what stops a German search BLS already answered from also calling Open
 * Food Facts, FatSecret and USDA. It is deliberately centralized and
 * deliberately dull, because it decides how much network traffic a keystroke
 * causes - and that has to be readable and testable in one place rather than
 * emerging from three components.
 *
 * The rule is *not* "a source returned something", and it is not "a source
 * returned something similar". "Nutella" is 0.8 similar to a dozen BLS entries
 * for nut spreads; if similarity were enough, no German search would ever
 * reach Open Food Facts and no branded product would ever be found. It takes
 * an exact identity - or a food this user has actually eaten before - *and* a
 * record complete enough to log.
 */

/**
 * How strongly a candidate matches, and how much of it is actually there.
 *
 * `strongMatch` comes from `hasStrongLocalMatch` in src/server/foods.ts, which
 * is the existing definition of an identity or familiar match: a barcode hit,
 * an exact name, an exact name-and-brand, an exact alias or official
 * translation, or a previously eaten food whose name is a close match. It is
 * not restated here, so the two can never drift apart.
 */
export interface CandidateSignals {
  strongMatch: boolean;
  /** Share of the primary nutrients that carry a value, in [0,1]. */
  completeness: number;
}

/**
 * Three of the four primary nutrients.
 *
 * A food that states energy and one macronutrient is not a usable diary
 * entry, and stopping the traversal on it would hide the complete version of
 * the same food sitting in the next tier. This threshold is the whole reason a
 * weak BLS hit still falls through to Open Food Facts.
 */
export const MIN_COMPLETENESS = 0.75;

export function isSufficientCandidate(signals: CandidateSignals): boolean {
  return signals.strongMatch && signals.completeness >= MIN_COMPLETENESS;
}

/** True when what has been found so far justifies asking no further source. */
export function isSufficient(candidates: CandidateSignals[]): boolean {
  return candidates.some(isSufficientCandidate);
}

/** Why a tier was not consulted, for diagnostics and for tests. */
export type TierSkipReason =
  | "disabled"
  | "sufficient-result"
  | "remote-not-requested"
  | "unsupported-for-barcode"
  | "not-configured";

export interface TierReport {
  source: string;
  /** Rows the stored half of this source contributed. */
  stored: number;
  /** Foods the network half of this source contributed. */
  remote: number;
  /** Set when the source's network half was not called. */
  skipped: TierSkipReason | null;
  /** Set when the source was called and failed. */
  failed: boolean;
}
