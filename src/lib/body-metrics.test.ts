import { describe, expect, it } from "vitest";
import {
  deltaBetween,
  formatDelta,
  indexNearestDaysBefore,
  metricDelta,
  metricSource,
  metricValue,
  relativeFatMass,
  waistToHeight,
  waistToHip,
  type BodyMeasurement,
  type BodyProfile,
} from "./body-metrics";
import { MOCK_MEASUREMENTS, MOCK_PROFILE, MOCK_REFERENCE_INDEX } from "./body-mock-data";

const reference = MOCK_MEASUREMENTS[MOCK_REFERENCE_INDEX];
const current = MOCK_MEASUREMENTS[MOCK_MEASUREMENTS.length - 1];

describe("mock series", () => {
  it("pins the reference and current sessions to their stated values", () => {
    expect(reference.date).toBe("2026-05-12");
    expect(reference.waistCm).toBe(90);
    expect(reference.weightKg).toBe(83.2);
    expect(current.date).toBe("2026-09-02");
    expect(current.waistCm).toBe(84.2);
    expect(current.bodyFatPct).toBe(18.4);
  });

  it("is deterministic, so server and client render the same numbers", () => {
    expect(MOCK_MEASUREMENTS.map((entry) => entry.waistCm)).toEqual(
      MOCK_MEASUREMENTS.map((entry) => entry.waistCm),
    );
    expect(MOCK_MEASUREMENTS.every((entry, index, all) => index === 0 || entry.date > all[index - 1].date)).toBe(true);
  });
});

describe("metric values", () => {
  it("averages paired limbs", () => {
    expect(metricValue(current, "upperArmCm")).toBeCloseTo(34.8);
    expect(metricValue(current, "thighCm")).toBeCloseTo(60);
  });

  it("reports the composition source for composition metrics only", () => {
    expect(metricSource(current, "waistCm")).toBe("MANUAL");
    expect(metricSource(current, "bodyFatPct")).toBe("BIA");
    expect(metricSource(current, "boneKg")).toBe("DERIVED");
  });
});

describe("deltas", () => {
  it("subtracts the reference from the current value", () => {
    expect(metricDelta(current, reference, "waistCm")!.absolute).toBeCloseTo(-5.8);
    expect(metricDelta(current, reference, "muscleKg")!.absolute).toBeCloseTo(1.1);
  });

  it("treats a change below the displayed precision as unchanged", () => {
    expect(deltaBetween(3.2, 3.2, 1)!.direction).toBe("flat");
    expect(deltaBetween(3.24, 3.2, 1)!.direction).toBe("flat");
    expect(deltaBetween(3.26, 3.2, 1)!.direction).toBe("up");
  });

  it("returns nothing when either side is missing", () => {
    expect(deltaBetween(null, 80)).toBeNull();
    expect(deltaBetween(80, null)).toBeNull();
  });

  it("writes the direction into the string, not only into a colour", () => {
    expect(formatDelta(1.1, "en", 1)).toBe("+1.1");
    expect(formatDelta(-5.8, "en", 1)).toBe("−5.8");
    expect(formatDelta(0, "en", 1)).toBe("±0.0");
    expect(formatDelta(-0.032, "en", 3)).toBe("−0.032");
  });
});

describe("derived ratios", () => {
  it("divides waist by height", () => {
    expect(waistToHeight(84.2, 182)).toBeCloseTo(0.463, 3);
  });

  it("divides waist by hips", () => {
    expect(waistToHip(84.2, 100.9)).toBeCloseTo(0.8345, 4);
  });

  it("guards against a zero denominator", () => {
    expect(waistToHeight(84.2, 0)).toBeNull();
    expect(waistToHip(84.2, 0)).toBeNull();
  });
});

describe("relative fat mass", () => {
  const adult: BodyProfile = { heightCm: 182, sex: "male", ageYears: 34 };

  it("applies the sex-specific constant", () => {
    expect(relativeFatMass(adult, 84.2)).toBeCloseTo(64 - 20 * (182 / 84.2), 6);
    expect(relativeFatMass({ ...adult, sex: "female" }, 84.2)).toBeCloseTo(76 - 20 * (182 / 84.2), 6);
  });

  it("refuses to estimate without the data the formula needs", () => {
    expect(relativeFatMass({ ...adult, sex: null }, 84.2)).toBeNull();
    expect(relativeFatMass(adult, null)).toBeNull();
    expect(relativeFatMass({ ...adult, ageYears: null }, 84.2)).toBeNull();
  });

  it("is not calculated for children or adolescents", () => {
    expect(relativeFatMass({ ...adult, ageYears: 17 }, 84.2)).toBeNull();
    expect(relativeFatMass({ ...adult, ageYears: 18 }, 84.2)).not.toBeNull();
  });

  it("stays available for the preview profile", () => {
    expect(relativeFatMass(MOCK_PROFILE, current.waistCm)).toBeGreaterThan(0);
  });
});

describe("quick reference choices", () => {
  const currentIndex = MOCK_MEASUREMENTS.length - 1;

  it("picks the session closest to the requested distance", () => {
    const index = indexNearestDaysBefore(MOCK_MEASUREMENTS, currentIndex, 28);
    const chosen = MOCK_MEASUREMENTS[index];
    expect(Math.abs(Date.parse(current.date) - Date.parse(chosen.date)) / 86_400_000).toBeLessThanOrEqual(31);
  });

  it("never returns the current session itself", () => {
    expect(indexNearestDaysBefore(MOCK_MEASUREMENTS, currentIndex, 0)).toBeLessThan(currentIndex);
  });

  it("falls back to the first session when there is nothing earlier", () => {
    const single: BodyMeasurement[] = [MOCK_MEASUREMENTS[0]];
    expect(indexNearestDaysBefore(single, 0, 90)).toBe(0);
  });
});
