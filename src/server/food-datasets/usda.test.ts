/**
 * USDA FoodData Central mapping, against real records from the bundled
 * downloads. The fixtures in `__fixtures__/usda-records.json` are copied
 * verbatim out of `datasets/bundled/usda-*.ndjson.gz`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  USDA_NUTRIENT_MAP,
  assertUsdaNutrientMap,
  mapUsdaRecord,
  mapUsdaRecords,
  usdaFoodType,
  usdaRawState,
  usdaServings,
  type UsdaFoodRecord,
} from "./usda";
import { NUTRIENT_BY_KEY } from "@/lib/nutrients";

const records = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "usda-records.json"), "utf8"),
) as UsdaFoodRecord[];

const byId = (fdcId: number) => {
  const record = records.find((entry) => entry.fdcId === fdcId);
  if (!record) throw new Error(`fixture ${fdcId} is missing`);
  return record;
};

const hummus = byId(321358); // Foundation, 119 nutrients, two portions
const snail = byId(167744); // SR Legacy, raw
const squash = byId(167632); // SR Legacy, cooked, "undetermined" measure unit

describe("the USDA nutrient map", () => {
  it("agrees with the nutrient catalogue", () => {
    expect(() => assertUsdaNutrientMap()).not.toThrow();
  });

  it("maps only to nutrients the catalogue defines", () => {
    for (const [key, candidates] of Object.entries(USDA_NUTRIENT_MAP)) {
      expect(NUTRIENT_BY_KEY.get(key), key).toBeDefined();
      expect(candidates.length).toBeGreaterThan(0);
    }
  });

  it("never lets two canonical keys claim the same FDC nutrient", () => {
    const ids = Object.values(USDA_NUTRIENT_MAP).flatMap((candidates) => candidates.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("mapping a Foundation record", () => {
  const mapped = mapUsdaRecord(hummus)!;

  it("preserves the FDC identity and the English name", () => {
    expect(mapped.externalId).toBe("321358");
    expect(mapped.name).toBe("Hummus, commercial");
    expect(mapped.locale).toBe("en");
    // FDC publishes English only; nothing is machine-translated.
    expect(mapped.translations).toEqual([]);
    expect(mapped.metadata).toMatchObject({ fdcId: 321358, dataType: "Foundation" });
  });

  it("maps the macronutrients on a per-100 g basis", () => {
    expect(mapped.basisAmount).toBe(100);
    expect(mapped.basisUnit).toBe("G");
    expect(mapped.nutrients.protein?.value).toBeGreaterThan(0);
    expect(mapped.nutrients.fat?.value).toBeGreaterThan(0);
    expect(mapped.nutrients.energyKcal?.value).toBeGreaterThan(0);
  });

  it("converts sodium from the milligrams FDC states to the grams NutriCore stores", () => {
    const sodium = mapped.nutrients.sodium!;
    expect(sodium.sourceUnit).toBe("mg");
    expect(sodium.value).toBeCloseTo(sodium.sourceValue! / 1000, 9);
  });

  it("records which FDC nutrient supplied each value", () => {
    // The map lists several candidates for energy and folate; which one was
    // used has to be visible rather than implied.
    expect(mapped.nutrients.energyKcal?.origin).toMatch(/^FDC nutrient \d+$/);
  });

  it("carries no qualifier, because FDC omits what it did not determine", () => {
    for (const nutrient of Object.values(mapped.nutrients)) {
      expect(nutrient.qualifier).toBeNull();
    }
  });

  it("reads the portion weights the record publishes", () => {
    expect(mapped.servings.length).toBeGreaterThan(0);
    const first = mapped.servings[0];
    expect(first.isDefault).toBe(true);
    expect(first.gramEquivalent).toBeGreaterThan(0);
    // A serving row states the weight of ONE of its unit, because that is what
    // resolvePortion multiplies by.
    expect(first.amount).toBe(1);
  });
});

describe("mapping SR Legacy records", () => {
  it("reads the preparation from the description", () => {
    expect(usdaRawState(snail.description)).toBe("raw");
    expect(usdaRawState(squash.description)).toBe("cooked");
    expect(usdaRawState("Hummus, commercial")).toBeNull();
  });

  it("prefers the preparation over the food category", () => {
    expect(usdaFoodType(snail)).toBe("RAW");
    expect(usdaFoodType(squash)).toBe("COOKED");
  });

  it("uses the modifier when the measure unit is undetermined", () => {
    // SR Legacy leaves measureUnit "undetermined" and puts the real measure in
    // the modifier ("oz", "serving", "cup, cubed").
    const servings = usdaServings(squash.portions);
    expect(servings.length).toBeGreaterThan(0);
    expect(servings[0].unit).toMatch(/^[\p{L}]+$/u);
    expect(servings[0].gramEquivalent).toBeGreaterThan(0);
  });

  it("maps every fixture record without skipping any", () => {
    const result = mapUsdaRecords(records);
    expect(result.foods).toHaveLength(records.length);
    expect(result.issues).toEqual([]);
  });
});

describe("what the mapper refuses to do", () => {
  it("skips a value whose stated unit is not the one the map expects", () => {
    // A vitamin A figure in IU is not a microgram figure. Converting it would
    // be wrong by a factor of ~3.3 for retinol and ~20 for beta-carotene.
    const tampered: UsdaFoodRecord = { ...hummus, nutrients: [[1106, "320", "IU", 500]] };
    const unmapped: Record<string, number> = {};
    const mapped = mapUsdaRecord(tampered, unmapped);
    expect(mapped?.nutrients.vitaminA).toBeUndefined();
    expect(unmapped["1106:unit=IU"]).toBe(1);
  });

  it("prefers the better candidate for a key regardless of array order", () => {
    // 1008 (standard energy) beats 2047 (Atwater), whichever comes first.
    const forwards = mapUsdaRecord({
      ...hummus,
      nutrients: [
        [1008, "208", "kcal", 100],
        [2047, "957", "kcal", 999],
      ],
    })!;
    const backwards = mapUsdaRecord({
      ...hummus,
      nutrients: [
        [2047, "957", "kcal", 999],
        [1008, "208", "kcal", 100],
      ],
    })!;
    expect(forwards.nutrients.energyKcal?.value).toBe(100);
    expect(backwards.nutrients.energyKcal?.value).toBe(100);
  });

  it("leaves a nutrient FDC does not publish absent rather than deriving it", () => {
    const mapped = mapUsdaRecord(hummus)!;
    // FDC states the individual n-3 fatty acids but no total, and no salt.
    expect(mapped.nutrients.omega3).toBeUndefined();
    expect(mapped.nutrients.salt).toBeUndefined();
  });

  it("ignores an entry with no numeric amount", () => {
    const mapped = mapUsdaRecord({
      ...hummus,
      nutrients: [[1003, "203", "g", Number.NaN as unknown as number]],
    });
    expect(mapped?.nutrients.protein).toBeUndefined();
  });

  it("reports a record with no id or description", () => {
    const result = mapUsdaRecords([{ ...hummus, description: "" }]);
    expect(result.foods).toEqual([]);
    expect(result.issues).toHaveLength(1);
  });
});
