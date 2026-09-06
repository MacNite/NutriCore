import { describe, expect, it } from "vitest";
import {
  decideSample,
  type ExistingRecords,
  type HealthSample,
  inRange,
  lastPerDay,
  lengthToCm,
  localDateKey,
  massToKg,
  percentToPct,
  stableId,
  summarise,
} from "./health-import";

const sample = (over: Partial<HealthSample> = {}): HealthSample => ({
  metric: "weightKg",
  date: "2024-02-29",
  recordedAt: "2024-02-29T07:30:00.000Z",
  value: 78.4,
  externalId: "a",
  source: "Withings",
  ...over,
});

const noRecords = (): ExistingRecords => ({
  weightByDate: new Map(),
  measurementByDate: new Map(),
  profileHeightCm: null,
  importedValueByExternalId: new Map(),
});

describe("unit conversion", () => {
  it("converts the mass units an export may use", () => {
    expect(massToKg(78.4, "kg")).toBeCloseTo(78.4, 5);
    expect(massToKg(172.5, "lb")).toBeCloseTo(78.2447, 3);
    expect(massToKg(12.5, "st")).toBeCloseTo(79.379, 3);
    expect(massToKg(78000, "g")).toBeCloseTo(78, 5);
  });

  it("refuses a unit it does not know rather than assuming kilograms", () => {
    // The failure this prevents: 168 lb silently becoming 168 kg.
    expect(massToKg(168, "furlong")).toBeNull();
    expect(massToKg(168, "")).toBeNull();
  });

  it("converts the length units an export may use", () => {
    expect(lengthToCm(183, "cm")).toBe(183);
    expect(lengthToCm(1.83, "m")).toBeCloseTo(183, 5);
    expect(lengthToCm(33.5, "in")).toBeCloseTo(85.09, 2);
    expect(lengthToCm(6, "ft")).toBeCloseTo(182.88, 2);
    expect(lengthToCm(183, "parsec")).toBeNull();
  });
});

describe("body fat percentage", () => {
  it("reads a fraction and a percentage as the same reading", () => {
    expect(percentToPct(0.223)).toBeCloseTo(22.3, 5);
    expect(percentToPct(22.3)).toBeCloseTo(22.3, 5);
  });

  it("rejects a value no body has", () => {
    expect(percentToPct(0)).toBeNull();
    expect(percentToPct(-1)).toBeNull();
    expect(percentToPct(230)).toBeNull();
  });
});

describe("plausible ranges", () => {
  it("drops readings a device produced during a fault", () => {
    expect(inRange("weightKg", 0)).toBe(false);
    expect(inRange("weightKg", 78.4)).toBe(true);
    expect(inRange("weightKg", 500)).toBe(false);
    expect(inRange("heightCm", 1.83)).toBe(false);
    expect(inRange("heightCm", 183)).toBe(true);
  });
});

describe("localDateKey", () => {
  it("uses the offset the export states, not the reader's timezone", () => {
    // 23:30 UTC on the 29th is already the 1st of March at +02:00.
    const instant = Date.UTC(2024, 1, 29, 23, 30);
    expect(localDateKey(instant, 0)).toBe("2024-02-29");
    expect(localDateKey(instant, 120)).toBe("2024-03-01");
    expect(localDateKey(instant, -300)).toBe("2024-02-29");
  });
});

describe("lastPerDay", () => {
  it("keeps the last reading of each day per metric", () => {
    const kept = lastPerDay([
      sample({ externalId: "morning", recordedAt: "2024-02-29T07:30:00.000Z", value: 78.4 }),
      sample({ externalId: "evening", recordedAt: "2024-02-29T19:55:00.000Z", value: 79.1 }),
      sample({ externalId: "next", date: "2024-03-01", recordedAt: "2024-03-01T06:15:00.000Z", value: 78.2 }),
    ]);

    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatchObject({ date: "2024-02-29", value: 79.1 });
    expect(kept[1]).toMatchObject({ date: "2024-03-01", value: 78.2 });
  });

  it("keeps one reading per metric on the same day", () => {
    const kept = lastPerDay([sample({ externalId: "w" }), sample({ metric: "waistCm", value: 85, externalId: "c" })]);
    expect(kept.map((entry) => entry.metric).sort()).toEqual(["waistCm", "weightKg"]);
  });

  it("does not depend on the order the file was read in", () => {
    const a = sample({ externalId: "a", recordedAt: "2024-02-29T08:00:00.000Z", value: 1 });
    const b = sample({ externalId: "b", recordedAt: "2024-02-29T08:00:00.000Z", value: 2 });
    expect(lastPerDay([a, b])).toEqual(lastPerDay([b, a]));
  });
});

describe("stableId", () => {
  it("gives the same record the same identity every export", () => {
    expect(stableId(["BodyMass", "2024-02-29 08:30:00 +0100", "78.4"])).toBe(
      stableId(["BodyMass", "2024-02-29 08:30:00 +0100", "78.4"]),
    );
  });

  it("separates records that differ in any field", () => {
    const ids = new Set([
      stableId(["BodyMass", "2024-02-29", "78.4"]),
      stableId(["BodyMass", "2024-02-29", "78.5"]),
      stableId(["BodyMass", "2024-03-01", "78.4"]),
      stableId(["BodyFat", "2024-02-29", "78.4"]),
    ]);
    expect(ids.size).toBe(4);
  });
});

describe("decideSample", () => {
  it("creates a weight on a day that has none", () => {
    expect(decideSample(sample(), noRecords())).toBe("create");
  });

  it("never overwrites a weight the user typed", () => {
    const existing = noRecords();
    existing.weightByDate.set("2024-02-29", { value: 80, source: "MANUAL" });
    expect(decideSample(sample(), existing)).toBe("skipManual");
  });

  it("updates a weight a previous import wrote", () => {
    const existing = noRecords();
    existing.weightByDate.set("2024-02-29", { value: 80, source: "HEALTH_PLATFORM" });
    expect(decideSample(sample(), existing)).toBe("update");
  });

  it("reports an unchanged re-import rather than rewriting it", () => {
    const existing = noRecords();
    existing.weightByDate.set("2024-02-29", { value: 78.4, source: "HEALTH_PLATFORM" });
    existing.importedValueByExternalId.set("a", 78.4);
    expect(decideSample(sample(), existing)).toBe("unchanged");
  });

  it("treats a body value with no provenance entry as hand-entered", () => {
    // The schema's rule: a field absent from valueSources was typed by a person.
    const existing = noRecords();
    existing.measurementByDate.set("2024-02-29", { bodyFatPct: 20, waistCm: null, sources: {} });
    expect(decideSample(sample({ metric: "bodyFatPct", value: 22.3 }), existing)).toBe("skipManual");
  });

  it("adds a value to a measurement session that left that column empty", () => {
    const existing = noRecords();
    existing.measurementByDate.set("2024-02-29", { bodyFatPct: null, waistCm: 85, sources: { waistCm: "MANUAL" } });
    expect(decideSample(sample({ metric: "bodyFatPct", value: 22.3 }), existing)).toBe("create");
  });

  it("will not argue with a height the user has already stated", () => {
    const existing = noRecords();
    existing.profileHeightCm = 180;
    expect(decideSample(sample({ metric: "heightCm", value: 183 }), existing)).toBe("skipManual");
  });

  it("fills in a height that is missing", () => {
    expect(decideSample(sample({ metric: "heightCm", value: 183 }), noRecords())).toBe("create");
  });
});

describe("summarise", () => {
  it("counts each metric and its span", () => {
    const result = summarise([
      sample({ date: "2024-02-29", externalId: "a" }),
      sample({ date: "2024-03-05", externalId: "b" }),
      sample({ metric: "waistCm", value: 85, date: "2024-03-01", externalId: "c", source: "Tape" }),
    ]);

    expect(result.total).toBe(3);
    expect(result.metrics).toEqual([
      { metric: "weightKg", count: 2, firstDate: "2024-02-29", lastDate: "2024-03-05" },
      { metric: "waistCm", count: 1, firstDate: "2024-03-01", lastDate: "2024-03-01" },
    ]);
    expect(result.sources).toEqual(["Tape", "Withings"]);
  });
});
