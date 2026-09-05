import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferScale, readHealthConnectDatabase, toInstantMs, toOffsetMinutes } from "./health-connect-export";
import { lastPerDay } from "./health-import";

const DB = new Uint8Array(readFileSync(new URL("../server/__fixtures__/health-connect.db", import.meta.url)));

describe("toInstantMs", () => {
  it("accepts milliseconds", () => {
    expect(toInstantMs(1709164800000)).toBe(1709164800000);
  });

  it("promotes a column that turned out to hold seconds", () => {
    expect(toInstantMs(1709164800)).toBe(1709164800000);
  });

  it("rejects a number that is not a timestamp at any scale", () => {
    expect(toInstantMs(42)).toBeNull();
    expect(toInstantMs(Number.NaN)).toBeNull();
  });
});

describe("toOffsetMinutes", () => {
  it("reads the seconds Health Connect records", () => {
    expect(toOffsetMinutes(3600)).toBe(60);
    expect(toOffsetMinutes(-18000)).toBe(-300);
  });

  it("falls back to UTC rather than inventing an offset", () => {
    expect(toOffsetMinutes(null)).toBe(0);
    expect(toOffsetMinutes("x")).toBe(0);
    // Beyond any real zone at every scale tried.
    expect(toOffsetMinutes(999_999_999)).toBe(0);
  });
});

describe("inferScale", () => {
  it("recognises grams and kilograms from the values themselves", () => {
    expect(inferScale([78000, 78100, 77900], "weightKg", [1, 0.001])).toBe(0.001);
    expect(inferScale([78, 78.1, 77.9], "weightKg", [1, 0.001])).toBe(1);
  });

  it("recognises metres and centimetres", () => {
    expect(inferScale([1.83, 1.84], "heightCm", [100, 1, 0.1])).toBe(100);
    expect(inferScale([183, 184], "heightCm", [100, 1, 0.1])).toBe(1);
  });

  it("is not dragged off by a minority of junk readings", () => {
    const values = [78000, 78100, 77900, 78200, 0, 78050, 78150, 77800, 78300, 78400];
    expect(inferScale(values, "weightKg", [1, 0.001])).toBe(0.001);
  });

  it("gives up rather than guessing when no scale fits", () => {
    expect(inferScale([1, 2, 3], "weightKg", [1, 0.001])).toBeNull();
    expect(inferScale([], "weightKg", [1, 0.001])).toBeNull();
  });
});

describe("reading a Health Connect database", () => {
  const { samples } = readHealthConnectDatabase(DB);

  it("finds the metrics it can store", () => {
    expect([...new Set(samples.map((sample) => sample.metric))].sort()).toEqual(["bodyFatPct", "heightCm", "weightKg"]);
  });

  it("does not read lean body mass as muscle mass", () => {
    // The fixture holds a lean_body_mass_record_table; nothing may come from it.
    expect(samples.some((sample) => sample.value === 60)).toBe(false);
  });

  it("converts grams to kilograms without being told the unit", () => {
    const weights = samples.filter((sample) => sample.metric === "weightKg");
    for (const weight of weights) expect(weight.value).toBeGreaterThan(70);
    for (const weight of weights) expect(weight.value).toBeLessThan(90);
  });

  it("converts metres to centimetres", () => {
    expect(samples.find((sample) => sample.metric === "heightCm")?.value).toBe(183);
  });

  it("reads a stored fraction as a percentage", () => {
    expect(samples.find((sample) => sample.metric === "bodyFatPct")?.value).toBeCloseTo(22.3, 1);
  });

  it("uses the stored zone offset to decide the day", () => {
    // 08:30 at +01:00 on the 29th, which is 07:30 UTC and still the 29th.
    expect(samples.some((sample) => sample.date === "2024-02-29")).toBe(true);
  });

  it("keeps the later of two readings on the same day", () => {
    const kept = lastPerDay(samples).filter((sample) => sample.metric === "weightKg" && sample.date === "2024-02-29");
    expect(kept).toHaveLength(1);
    // 76.5 kg at 20:00 beats both 77.0 at 06:30 and 78.0 at 07:30.
    expect(kept[0].value).toBeCloseTo(76.5, 1);
  });

  it("gives each row an identity drawn from its own uuid", () => {
    const ids = new Set(samples.map((sample) => sample.externalId));
    expect(ids.size).toBe(samples.length);
  });

  it("reads the same file the same way twice", () => {
    expect(readHealthConnectDatabase(DB).samples).toEqual(samples);
  });
});
