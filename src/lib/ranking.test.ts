import { describe, expect, it } from "vitest";
import { BARCODE_SCORE, SOURCE_TRUST, completeness, rankFood, textSimilarity } from "./ranking";

const base = { textMatch: 0.8, dataCompleteness: 0.8, sourceTrust: 0.8 };

describe("ranking", () => {
  it("gives a barcode match absolute priority", () => {
    expect(rankFood({ ...base, barcodeMatch: true })).toBe(BARCODE_SCORE);
    expect(rankFood({ ...base, barcodeMatch: true })).toBeGreaterThan(
      rankFood({ textMatch: 1, exactNameMatch: true, dataCompleteness: 1, sourceTrust: 1, favorite: true }),
    );
  });

  it("boosts favorites, recency and frequency", () => {
    expect(rankFood({ ...base, favorite: true })).toBeGreaterThan(rankFood(base));
    expect(rankFood({ ...base, daysSinceUse: 1 })).toBeGreaterThan(rankFood({ ...base, daysSinceUse: 30 }));
    expect(rankFood({ ...base, usageFrequency: 20 })).toBeGreaterThan(rankFood({ ...base, usageFrequency: 1 }));
  });

  it("scales frequency logarithmically so one food cannot dominate", () => {
    // Equal additive steps must yield shrinking gains.
    const firstNine = rankFood({ ...base, usageFrequency: 10 }) - rankFood({ ...base, usageFrequency: 1 });
    const lastNine = rankFood({ ...base, usageFrequency: 1000 }) - rankFood({ ...base, usageFrequency: 991 });
    expect(lastNine).toBeLessThan(firstNine);
    // And the whole frequency bonus stays smaller than an exact-name match.
    expect(rankFood({ ...base, usageFrequency: 10_000 }) - rankFood(base)).toBeLessThan(500);
  });

  it("never lets an AI estimate outrank a good trusted match", () => {
    const trusted = rankFood({ textMatch: 1, exactNameMatch: true, dataCompleteness: 1, sourceTrust: 1 });
    const confidentAI = rankFood({ textMatch: 1, dataCompleteness: 1, sourceTrust: 0.25, isAI: true, aiConfidence: 0.95 });
    const weakAI = rankFood({ textMatch: 1, dataCompleteness: 1, sourceTrust: 0.25, isAI: true, aiConfidence: 0.1 });
    expect(trusted).toBeGreaterThan(confidentAI);
    expect(confidentAI).toBeGreaterThan(weakAI);
  });

  it("penalises a low-confidence AI result more than a confident one", () => {
    const high = rankFood({ ...base, isAI: true, aiConfidence: 0.9 });
    const low = rankFood({ ...base, isAI: true, aiConfidence: 0.2 });
    expect(high - low).toBeCloseTo(0.7 * 200);
  });

  it("prefers personal foods and better data at equal text match", () => {
    expect(rankFood({ ...base, customFood: true })).toBeGreaterThan(rankFood(base));
    expect(rankFood({ ...base, dataCompleteness: 1 })).toBeGreaterThan(rankFood({ ...base, dataCompleteness: 0.25 }));
  });

  it("does not let owning a food make up for a worse name match", () => {
    // "Zwiebel": the BLS onion against the user's own "Rote Zwiebel Salsa",
    // with the similarities the two names actually produce.
    const onion = rankFood({
      textMatch: textSimilarity("zwiebel", "speisezwiebel roh"),
      dataCompleteness: 1,
      sourceTrust: SOURCE_TRUST.BLS,
      localeMatch: true,
    });
    const salsa = rankFood({
      textMatch: textSimilarity("zwiebel", "rote zwiebel salsa"),
      dataCompleteness: 1,
      sourceTrust: SOURCE_TRUST.RECIPE,
      localeMatch: true,
      personalRecipe: true,
    });
    expect(onion).toBeGreaterThan(salsa);
  });

  it("still gives a personal food the whole bonus when it is what was asked for", () => {
    const asked = { ...base, textMatch: 1, exactNameMatch: true };
    expect(rankFood({ ...asked, personalRecipe: true }) - rankFood(asked)).toBe(90);
    // And browsing the recent list, where there is no name to match at all.
    const browsed = { textMatch: 0, dataCompleteness: 1, sourceTrust: 0.9, browsing: true };
    expect(rankFood({ ...browsed, customFood: true }) - rankFood(browsed)).toBe(90);
  });

  it("is deterministic", () => {
    const signals = { ...base, favorite: true, daysSinceUse: 3, usageFrequency: 7 };
    expect(rankFood(signals)).toBe(rankFood(signals));
  });
});

describe("text similarity", () => {
  it("scores an exact match highest and a miss lowest", () => {
    expect(textSimilarity("skyr", "skyr")).toBe(1);
    expect(textSimilarity("skyr", "rice cakes")).toBe(0);
  });

  it("rewards prefixes and partial token overlap", () => {
    // No longer the flat 0.8 this used to assert: a name that begins with the
    // query still has to answer for the rest of itself, so the value now falls
    // with each further word. What matters is the order it produces.
    expect(textSimilarity("skyr", "skyr natur")).toBeGreaterThan(textSimilarity("skyr", "skyr natur vanille"));
    expect(textSimilarity("skyr natur", "skyr")).toBeGreaterThan(0);
    expect(textSimilarity("skyr natur", "skyr natur vanille")).toBeGreaterThan(textSimilarity("skyr natur", "skyr"));
  });

  it("reads a German compound as the food its head names", () => {
    // "Speisezwiebel" is a Zwiebel; nothing in it starts with the word, which
    // is why BLS onions used to score zero for the query and stay invisible.
    expect(textSimilarity("zwiebel", "speisezwiebel roh")).toBeGreaterThan(0.5);
    // A compound head counts for more than the same word as a prefix, which is
    // usually another food made of it.
    expect(textSimilarity("zwiebel", "speisezwiebel")).toBeGreaterThan(textSimilarity("zwiebel", "zwiebelsuppe"));
  });

  it("counts what the name says beyond the query, not only what it answers", () => {
    // The reported case: a dish that merely contains onions must not tie the
    // onion itself.
    expect(textSimilarity("zwiebel", "speisezwiebel roh")).toBeGreaterThan(
      textSimilarity("zwiebel", "rote zwiebel salsa"),
    );
    // And a qualifier costs far less than a whole further ingredient.
    expect(textSimilarity("zwiebel", "zwiebel roh")).toBeGreaterThan(textSimilarity("zwiebel", "zwiebel salsa rot"));
  });
});

describe("completeness", () => {
  it("counts only nutrients that carry a value", () => {
    expect(completeness({ energyKcal: 100, protein: 5, carbohydrate: 10, fat: 2 })).toBe(1);
    expect(completeness({ energyKcal: 100, protein: null, carbohydrate: null, fat: null })).toBe(0.25);
    expect(completeness({})).toBe(0);
  });
});
