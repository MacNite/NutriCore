import { describe, expect, it } from "vitest";
import { hasUsableEnergy } from "./nutrients";

describe("hasUsableEnergy", () => {
  it("accepts a stated energy value", () => {
    expect(hasUsableEnergy({ energyKcal: 120 })).toBe(true);
  });

  it("keeps a genuine zero: mineral water is not missing data", () => {
    expect(hasUsableEnergy({ energyKcal: 0, protein: 0 })).toBe(true);
  });

  it("accepts kJ alone, because kcal is derivable from it", () => {
    expect(hasUsableEnergy({ energyKcal: null, energyKj: 502 })).toBe(true);
  });

  it("rejects a food whose energy is missing rather than zero", () => {
    expect(hasUsableEnergy({ energyKcal: null, protein: 12, fat: 3 })).toBe(false);
    expect(hasUsableEnergy({ protein: 12 })).toBe(false);
    expect(hasUsableEnergy({})).toBe(false);
    expect(hasUsableEnergy(null)).toBe(false);
    expect(hasUsableEnergy(undefined)).toBe(false);
  });

  it("rejects values that are not real numbers", () => {
    expect(hasUsableEnergy({ energyKcal: Number.NaN })).toBe(false);
    expect(hasUsableEnergy({ energyKcal: -50 })).toBe(false);
  });
});
