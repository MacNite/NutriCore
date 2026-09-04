import { describe, expect, it } from "vitest";
import { allowedUnits, canonicalUnit, normalizeName, parseServingDensity, parseServingSize, resolveIngredientWeight, resolvePortion, servingLabelFor } from "./units";

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

describe("the units a food can be measured in", () => {
  const flour = { basisUnit: "G" as const, densityGPerMl: null, servings: [] };
  const milk = { basisUnit: "ML" as const, densityGPerMl: 1.03, servings: [] };

  it("reads the source's own spelling of a metric unit", () => {
    expect(canonicalUnit("Gramm")).toBe("g");
    expect(canonicalUnit(" GRAMS ")).toBe("g");
    expect(canonicalUnit("Milliliter")).toBe("ml");
    // A measure word is not a metric unit and has no weight to map to.
    expect(canonicalUnit("EL")).toBeNull();
    expect(canonicalUnit("Stück")).toBeNull();
  });

  it("offers only what this food can actually be converted from", () => {
    // No density, so the volume family would fail the save and is not offered.
    expect(allowedUnits(flour)).toEqual(["g", "kg", "mg"]);
    expect(allowedUnits(milk)).toEqual(["ml", "l", "dl", "cl", "g", "kg", "mg"]);
  });

  it("adds a named portion once the food defines its weight", () => {
    const withServing = { ...flour, servings: [{ label: "Scheibe", unit: "Scheibe", amount: 1, gramEquivalent: 25 }] };
    expect(allowedUnits(withServing)).toContain("Scheibe");
    // Named but weightless: `resolvePortion` cannot use it, so neither is it offered.
    const weightless = { ...flour, servings: [{ label: "Prise", unit: "Prise", amount: 1, gramEquivalent: null }] };
    expect(allowedUnits(weightless)).not.toContain("Prise");
  });

  it("never offers a unit the portion resolver would reject", () => {
    for (const food of [flour, milk]) {
      for (const unit of allowedUnits(food)) expect(resolvePortion(1, unit, food).ok).toBe(true);
    }
  });

  it("offers nothing for a food sold by volume with no density", () => {
    // The portion resolves - to millilitres - but a recipe ingredient needs a
    // weight, and 1 ml is not 1 g. Offering "ml" here was how a saved recipe
    // came back as "Cannot resolve portion: density-required".
    const broth = { basisUnit: "ML" as const, densityGPerMl: null, servings: [] };
    expect(resolvePortion(250, "ml", broth).ok).toBe(true);
    expect(resolveIngredientWeight(250, "ml", broth)).toEqual({ ok: false, reason: "density-required" });
    expect(allowedUnits(broth)).toEqual([]);
  });

  it("weighs a volume through the food's own density", () => {
    expect(resolveIngredientWeight(250, "ml", milk)).toMatchObject({ ok: true, weightG: 257.5 });
    expect(resolveIngredientWeight(200, "g", flour)).toMatchObject({ ok: true, weightG: 200 });
  });

  it("never offers a unit a recipe ingredient could not be weighed in", () => {
    const foods = [flour, milk, { basisUnit: "ML" as const, densityGPerMl: null, servings: [] }];
    for (const food of foods) {
      for (const unit of allowedUnits(food)) expect(resolveIngredientWeight(1, unit, food).ok).toBe(true);
    }
  });
});

describe("a counted portion, in either language", () => {
  const egg = {
    basisUnit: "G" as const,
    densityGPerMl: null,
    servings: [{ label: "Stück", unit: "Stück", amount: 1, gramEquivalent: 58, mlEquivalent: null }],
  };

  it("weighs a piece against the food's own Stück", () => {
    // A counted line carries no measure word, so the parser calls it "piece"
    // while the food says "Stück". Matching on the string alone failed every
    // counted German ingredient and reported the food's own weight as unusable.
    expect(resolveIngredientWeight(2, "piece", egg)).toMatchObject({ ok: true, weightG: 116 });
    expect(resolveIngredientWeight(2, "Stk", egg)).toMatchObject({ ok: true, weightG: 116 });
    expect(servingLabelFor("piece", egg)).toBe("Stück");
  });

  it("still refuses a portion the food does not define", () => {
    expect(resolveIngredientWeight(2, "Scheibe", egg).ok).toBe(false);
    expect(servingLabelFor("Scheibe", egg)).toBeNull();
  });
});

describe("the density a serving size states outright", () => {
  it("reads a serving written as both a volume and a weight", () => {
    // The only density Open Food Facts ever publishes, and worth more than any
    // estimate because the product measured it.
    expect(parseServingDensity("250 ml (258 g)")).toBeCloseTo(1.032);
    expect(parseServingDensity("1 Glas (200ml / 206g)")).toBeCloseTo(1.03);
  });

  it("ignores a serving that states only one of the two", () => {
    expect(parseServingDensity("30 g")).toBeNull();
    expect(parseServingDensity("250 ml")).toBeNull();
    expect(parseServingDensity(null)).toBeNull();
  });

  it("refuses a pair that cannot be one food's density", () => {
    // A bottle size printed beside a portion is two unrelated numbers, not a
    // measurement: storing their ratio would invent a density no food has.
    expect(parseServingDensity("500 ml (30 g portion)")).toBeNull();
  });
});
