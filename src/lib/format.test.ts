import { describe, expect, it } from "vitest";
import { formatDate, formatKcal, formatNumber, formatNutrient, formatPercent } from "./format";

describe("locale-aware formatting", () => {
  it("uses German and English separators", () => {
    expect(formatNumber(1234.5, "de")).toBe("1.234,5");
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
  });

  it("rounds energy to whole kilocalories", () => {
    expect(formatKcal(1980.4, "de")).toBe("1.980");
    expect(formatKcal(1980.4, "en")).toBe("1,980");
  });

  it("renders an unknown nutrient as a dash, never as zero", () => {
    expect(formatNutrient(null, "de")).toBe("–");
    expect(formatNutrient(undefined, "en")).toBe("–");
    expect(formatNutrient(Number.NaN, "en")).toBe("–");
    expect(formatNutrient(0, "en")).toBe("0");
  });

  it("keeps trace amounts visible instead of rounding them to zero", () => {
    expect(formatNutrient(0.02, "en")).toBe("0.02");
  });

  it("formats percentages and dates per locale", () => {
    // German uses a non-breaking space before the percent sign.
    expect(formatPercent(0.63, "de")).toBe("63\u00a0%");
    expect(formatPercent(0.63, "en")).toBe("63%");
    expect(formatDate("2026-08-30", "de")).toBe("30.08.2026");
    expect(formatDate("2026-08-30", "en")).toBe("Aug 30, 2026");
  });
});
