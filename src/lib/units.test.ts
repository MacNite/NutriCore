import { describe, expect, it } from "vitest";
import { normalizeName, parseServingSize, resolvePortion } from "./units";

const gramFood = { basisUnit: "G" as const };
const mlFood = { basisUnit: "ML" as const };

describe("portion resolution", () => {
  it("converts mass units within the gram basis", () => {
    expect(resolvePortion(1.5, "kg", gramFood)).toEqual({ ok: true, amount: 1500, unit: "G" });
    expect(resolvePortion(500, "mg", gramFood)).toEqual({ ok: true, amount: 0.5, unit: "G" });
  });

  it("refuses volume-to-mass without a stored density", () => {
    expect(resolvePortion(200, "ml", gramFood)).toEqual({ ok: false, reason: "density-required" });
  });

  it("uses a stored density when one exists", () => {
    const oil = { basisUnit: "G" as const, densityGPerMl: 0.92 };
    expect(resolvePortion(100, "ml", oil)).toEqual({ ok: true, amount: 92, unit: "G" });
  });

  it("never assumes 1 ml equals 1 g", () => {
    const result = resolvePortion(100, "ml", gramFood);
    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ amount: 100 });
  });

  it("keeps volume foods in millilitres", () => {
    expect(resolvePortion(0.5, "l", mlFood)).toEqual({ ok: true, amount: 500, unit: "ML" });
  });

  it("resolves named portions only through stored equivalents", () => {
    const bread = {
      basisUnit: "G" as const,
      servings: [{ label: "Scheibe", amount: 1, unit: "slice", gramEquivalent: 42 }],
    };
    expect(resolvePortion(2, "Scheibe", bread)).toEqual({ ok: true, amount: 84, unit: "G" });
    expect(resolvePortion(2, "cup", bread)).toEqual({ ok: false, reason: "unknown-unit" });
  });

  it("rejects negative and non-finite amounts", () => {
    expect(resolvePortion(-1, "g", gramFood)).toEqual({ ok: false, reason: "invalid-amount" });
    expect(resolvePortion(Number.NaN, "g", gramFood)).toEqual({ ok: false, reason: "invalid-amount" });
  });
});

describe("serving size parsing", () => {
  it("parses plain and parenthesised quantities", () => {
    expect(parseServingSize("30 g")).toEqual({ amount: 30, unit: "g" });
    expect(parseServingSize("250ml")).toEqual({ amount: 250, unit: "ml" });
    expect(parseServingSize("1 Scheibe (25 g)")).toEqual({ amount: 25, unit: "g" });
    expect(parseServingSize("2,5 g")).toEqual({ amount: 2.5, unit: "g" });
  });

  it("returns null rather than inventing a portion", () => {
    expect(parseServingSize("1 Portion")).toBeNull();
    expect(parseServingSize(null)).toBeNull();
    expect(parseServingSize("")).toBeNull();
  });
});

describe("name normalisation", () => {
  it("folds case, accents and punctuation", () => {
    expect(normalizeName("  Müsli-Riegel, Schoko!  ")).toBe("musli riegel schoko");
  });

  it("keeps brand and product words distinct", () => {
    expect(normalizeName("Alpro Soja Drink")).toBe("alpro soja drink");
    expect(normalizeName("Alpro Soja Drink")).not.toBe(normalizeName("Alpro Soja"));
  });
});
