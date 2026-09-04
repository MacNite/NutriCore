import { describe, expect, it } from "vitest";
import { MIN_COMPLETENESS, isSufficient, isSufficientCandidate } from "./food-search-policy";

const candidate = (strongMatch: boolean, completeness: number) => ({ strongMatch, completeness });

describe("when a search may stop asking further sources", () => {
  it("stops on a strong match that is complete enough to log", () => {
    expect(isSufficientCandidate(candidate(true, 1))).toBe(true);
    expect(isSufficientCandidate(candidate(true, MIN_COMPLETENESS))).toBe(true);
  });

  it("does not stop on a strong match that is missing most of its nutrients", () => {
    // This is what lets a thin BLS record fall through to Open Food Facts
    // instead of ending the search with an unusable answer.
    expect(isSufficientCandidate(candidate(true, 0.5))).toBe(false);
    expect(isSufficientCandidate(candidate(true, 0.25))).toBe(false);
    expect(isSufficientCandidate(candidate(true, 0))).toBe(false);
  });

  it("does not stop on a complete food that is merely similar", () => {
    // "Nutella" is ~0.8 similar to a dozen BLS nut-spread entries. If
    // similarity were enough, no German search would ever reach Open Food
    // Facts and no branded product would ever be found.
    expect(isSufficientCandidate(candidate(false, 1))).toBe(false);
  });

  it("needs three of the four primary nutrients", () => {
    expect(MIN_COMPLETENESS).toBe(0.75);
    expect(isSufficientCandidate(candidate(true, 3 / 4))).toBe(true);
    expect(isSufficientCandidate(candidate(true, 2 / 4))).toBe(false);
  });

  it("stops as soon as any one candidate is enough", () => {
    expect(isSufficient([candidate(false, 1), candidate(true, 1)])).toBe(true);
  });

  it("does not stop when nothing found so far is enough", () => {
    expect(isSufficient([])).toBe(false);
    expect(isSufficient([candidate(false, 1), candidate(true, 0.5)])).toBe(false);
  });

  it("is deterministic: the same signals always give the same answer", () => {
    const signals = [candidate(true, 0.75), candidate(false, 1)];
    const answers = Array.from({ length: 20 }, () => isSufficient(signals));
    expect(new Set(answers).size).toBe(1);
  });
});
