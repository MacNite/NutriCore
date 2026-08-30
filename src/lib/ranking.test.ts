import { describe, expect, it } from "vitest";
import { BARCODE_SCORE, completeness, rankFood, textSimilarity } from "./ranking";

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
    expect(textSimilarity("skyr", "skyr natur")).toBeGreaterThanOrEqual(0.8);
    expect(textSimilarity("skyr natur", "skyr")).toBeGreaterThan(0);
    expect(textSimilarity("skyr natur", "skyr natur vanille")).toBeGreaterThan(textSimilarity("skyr natur", "skyr"));
  });
});

describe("completeness", () => {
  it("counts only nutrients that carry a value", () => {
    expect(completeness({ energyKcal: 100, protein: 5, carbohydrate: 10, fat: 2 })).toBe(1);
    expect(completeness({ energyKcal: 100, protein: null, carbohydrate: null, fat: null })).toBe(0.25);
    expect(completeness({})).toBe(0);
  });
});
