import { describe, expect, it } from "vitest";
import {
  bodyMassIndex,
  carryForward,
  deltaBetween,
  emptyMeasurement,
  formatDelta,
  indexNearestDaysBefore,
  isEmptyMeasurement,
  metricDelta,
  metricSource,
  metricValue,
  relativeFatMass,
  waistToHeight,
  waistToHip,
  type BodyMeasurement,
  type BodyProfile,
} from "./body-metrics";

const session = (date: string, values: Partial<BodyMeasurement> = {}): BodyMeasurement => ({
  ...emptyMeasurement(date),
  ...values,
});

const reference = session("2026-05-12", {
  weightKg: 83.2,
  waistCm: 90,
  hipCm: 103,
  upperArmLeftCm: 33.7,
  upperArmRightCm: 34.3,
  bodyFatPct: 20.6,
  muscleKg: 33.7,
  boneKg: 3.2,
  compositionSource: "BIA",
});

const current = session("2026-09-02", {
  weightKg: 78.4,
  waistCm: 84.2,
  hipCm: 100.9,
  upperArmLeftCm: 34.5,
  upperArmRightCm: 35.1,
  bodyFatPct: 18.4,
  muscleKg: 34.8,
  boneKg: 3.2,
  compositionSource: "BIA",
});

describe("metric values", () => {
  it("averages paired limbs", () => {
    expect(metricValue(current, "upperArmCm")).toBeCloseTo(34.8);
  });

  it("uses the one side that was measured rather than discarding it", () => {
    expect(metricValue(session("x", { thighLeftCm: 60 }), "thighCm")).toBe(60);
    expect(metricValue(session("x", { thighRightCm: 58 }), "thighCm")).toBe(58);
  });

  it("reports nothing for a metric nobody recorded", () => {
    expect(metricValue(session("x"), "waistCm")).toBeNull();
    expect(metricValue(session("x"), "calfCm")).toBeNull();
  });

  it("labels composition by the session's device and bone as derived", () => {
    expect(metricSource(current, "waistCm")).toBe("MANUAL");
    expect(metricSource(current, "bodyFatPct")).toBe("BIA");
    expect(metricSource(session("x", { compositionSource: "OTHER_DEVICE" }), "muscleKg")).toBe("OTHER_DEVICE");
    expect(metricSource(current, "boneKg")).toBe("DERIVED");
  });

  it("recognises a session with nothing in it", () => {
    expect(isEmptyMeasurement(emptyMeasurement("2026-01-01"))).toBe(true);
    expect(isEmptyMeasurement(current)).toBe(false);
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

  it("returns nothing when either side was never measured", () => {
    expect(deltaBetween(null, 80)).toBeNull();
    expect(deltaBetween(80, null)).toBeNull();
    expect(metricDelta(current, emptyMeasurement("2026-01-01"), "waistCm")).toBeNull();
  });

  it("writes the direction into the string, not only into a colour", () => {
    expect(formatDelta(1.1, "en", 1)).toBe("+1.1");
    expect(formatDelta(-5.8, "en", 1)).toBe("−5.8");
    expect(formatDelta(0, "en", 1)).toBe("±0.0");
    expect(formatDelta(-0.032, "en", 3)).toBe("−0.032");
  });
});

describe("carrying values forward", () => {
  const series = [
    session("2026-01-01", { waistCm: 92, chestCm: 101, thighLeftCm: 59, thighRightCm: 59 }),
    session("2026-01-08", { waistCm: 91 }),
    session("2026-01-15", { waistCm: 90 }),
  ];

  it("keeps what this session measured", () => {
    const { measurement, carried } = carryForward(series, 2);
    expect(measurement.waistCm).toBe(90);
    expect(carried.has("waistCm")).toBe(false);
  });

  it("fills a gap from the most recent earlier session", () => {
    const { measurement, carried } = carryForward(series, 2);
    expect(measurement.chestCm).toBe(101);
    expect(carried.has("chestCm")).toBe(true);
  });

  it("carries a paired limb onto both sides, because the drawing uses the pair", () => {
    const { measurement } = carryForward(series, 2);
    expect(measurement.thighLeftCm).toBe(59);
    expect(measurement.thighRightCm).toBe(59);
  });

  it("leaves a metric that was never recorded empty", () => {
    const { measurement, carried } = carryForward(series, 2);
    expect(measurement.neckCm).toBeNull();
    expect(carried.has("neckCm")).toBe(false);
  });

  it("has nothing to carry into the first session", () => {
    expect(carryForward(series, 0).carried.size).toBe(0);
  });
});

describe("derived ratios", () => {
  it("calculates BMI from weight and height", () => {
    expect(bodyMassIndex(78.4, 182)).toBeCloseTo(23.67, 2);
    expect(bodyMassIndex(null, 182)).toBeNull();
    expect(bodyMassIndex(78.4, 0)).toBeNull();
  });

  it("divides waist by height and waist by hips", () => {
    expect(waistToHeight(84.2, 182)).toBeCloseTo(0.463, 3);
    expect(waistToHip(84.2, 100.9)).toBeCloseTo(0.8345, 4);
  });

  it("guards against a zero or missing denominator", () => {
    expect(waistToHeight(84.2, 0)).toBeNull();
    expect(waistToHip(84.2, null)).toBeNull();
    expect(waistToHeight(null, 182)).toBeNull();
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
    expect(relativeFatMass({ ...adult, heightCm: 0 }, 84.2)).toBeNull();
  });

  it("is not calculated for children or adolescents", () => {
    expect(relativeFatMass({ ...adult, ageYears: 17 }, 84.2)).toBeNull();
    expect(relativeFatMass({ ...adult, ageYears: 18 }, 84.2)).not.toBeNull();
  });
});

describe("quick reference choices", () => {
  const series = Array.from({ length: 10 }, (_unused, index) =>
    session(new Date(Date.UTC(2026, 0, 1 + index * 7)).toISOString().slice(0, 10)),
  );

  it("picks the session closest to the requested distance", () => {
    expect(indexNearestDaysBefore(series, 9, 28)).toBe(5);
    expect(indexNearestDaysBefore(series, 9, 63)).toBe(0);
  });

  it("never returns the current session itself", () => {
    expect(indexNearestDaysBefore(series, 9, 0)).toBeLessThan(9);
  });

  it("falls back to the first session when there is nothing earlier", () => {
    expect(indexNearestDaysBefore([series[0]], 0, 90)).toBe(0);
  });
});
