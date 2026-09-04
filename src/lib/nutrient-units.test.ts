import { describe, expect, it } from "vitest";
import { UnitConversionError, convertNutrientValue, isConvertible, tidyNutrientValue } from "./nutrient-units";

describe("converting a nutrient amount", () => {
  it("is the identity for the same unit", () => {
    expect(convertNutrientValue(12.5, "g", "g")).toBe(12.5);
  });

  it("converts the four pairs the bundled databases actually need", () => {
    // BLS states sodium in mg where NutriCore stores g, and copper, manganese
    // and vitamin B6 in µg where NutriCore stores mg.
    expect(convertNutrientValue(8, "mg", "g")).toBeCloseTo(0.008, 9);
    expect(convertNutrientValue(484, "µg", "mg")).toBeCloseTo(0.484, 9);
    expect(convertNutrientValue(6160, "µg", "mg")).toBeCloseTo(6.16, 9);
    expect(convertNutrientValue(960, "µg", "mg")).toBeCloseTo(0.96, 9);
  });

  it("converts up as well as down", () => {
    expect(convertNutrientValue(0.5, "g", "mg")).toBeCloseTo(500, 9);
    expect(convertNutrientValue(2, "mg", "µg")).toBeCloseTo(2000, 9);
    expect(convertNutrientValue(1, "g", "µg")).toBeCloseTo(1e6, 3);
  });

  it("accepts every spelling of the microgram that appears in real data", () => {
    // MICRO SIGN, GREEK SMALL LETTER MU, and the "mcg" of label data.
    for (const unit of ["µg", "μg", "mcg"]) {
      expect(convertNutrientValue(1000, unit, "mg")).toBeCloseTo(1, 9);
    }
  });

  it("converts energy between kilojoules and kilocalories", () => {
    expect(convertNutrientValue(100, "kcal", "kJ")).toBeCloseTo(418.4, 6);
    expect(convertNutrientValue(418.4, "kJ", "kcal")).toBeCloseTo(100, 6);
  });

  it("refuses a pair it does not know instead of guessing a factor", () => {
    // The whole point: a wrong factor is a plausible-looking number, so the
    // conversion has to fail rather than produce one.
    expect(() => convertNutrientValue(500, "IU", "µg")).toThrow(UnitConversionError);
    expect(() => convertNutrientValue(10, "%", "mg")).toThrow(UnitConversionError);
    expect(() => convertNutrientValue(10, "g", "kcal")).toThrow(UnitConversionError);
  });

  it("reports which pair it could not convert", () => {
    try {
      convertNutrientValue(1, "IU", "mg");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnitConversionError);
      expect((error as UnitConversionError).from).toBe("IU");
      expect((error as UnitConversionError).to).toBe("mg");
    }
  });

  it("answers the same question without converting", () => {
    expect(isConvertible("mg", "g")).toBe(true);
    expect(isConvertible("kJ", "kcal")).toBe(true);
    expect(isConvertible("IU", "µg")).toBe(false);
    expect(isConvertible("g", "kJ")).toBe(false);
  });
});

describe("tidying a converted value", () => {
  it("removes the floating-point dust a division leaves", () => {
    expect(tidyNutrientValue(33.6 / 1000)).toBe(0.0336);
    expect(tidyNutrientValue(6160 / 1000)).toBe(6.16);
  });

  it("leaves an integer and a short decimal exactly as they are", () => {
    expect(tidyNutrientValue(343)).toBe(343);
    expect(tidyNutrientValue(11.45)).toBe(11.45);
  });

  it("keeps far more precision than any nutrient is measured to", () => {
    expect(tidyNutrientValue(0.123456789012)).toBe(0.123456789012);
  });

  it("passes a non-finite value through rather than inventing one", () => {
    expect(tidyNutrientValue(Number.NaN)).toBeNaN();
  });
});
