import { describe, expect, it } from "vitest";
import { hasTrendLine, movingAverage, weightStats } from "./weight";

const series = [80, 81, 79, 80.5, 80, 79.5, 80, 79].map((weightKg, index) => ({
  date: `2026-08-${String(index + 1).padStart(2, "0")}`,
  weightKg,
}));

describe("moving average", () => {
  it("returns null until the window is full", () => {
    const averages = movingAverage(series, 7);
    expect(averages.slice(0, 6).every((value) => value === null)).toBe(true);
    expect(averages[6]).not.toBeNull();
  });

  it("averages the trailing window", () => {
    const averages = movingAverage(series, 7);
    expect(averages[6]).toBeCloseTo((80 + 81 + 79 + 80.5 + 80 + 79.5 + 80) / 7);
  });

  it("smooths a single-day spike far more than the raw value moves", () => {
    const spiked = [...series];
    spiked[7] = { ...spiked[7], weightKg: 84 };
    const before = movingAverage(series, 7)[7]!;
    const after = movingAverage(spiked, 7)[7]!;
    expect(Math.abs(after - before)).toBeLessThan(5 / 7 + 0.001);
  });

  it("produces nothing but nulls for a short history", () => {
    expect(movingAverage(series.slice(0, 3), 7).every((value) => value === null)).toBe(true);
  });
});

describe("weight stats", () => {
  it("summarises the range and the net change", () => {
    const stats = weightStats(series)!;
    expect(stats.min).toBe(79);
    expect(stats.max).toBe(81);
    expect(stats.changeKg).toBe(-1);
  });

  it("returns null with no entries", () => {
    expect(weightStats([])).toBeNull();
  });
});

describe("trend line", () => {
  it("needs two averaged points before a line can be drawn", () => {
    expect(hasTrendLine(series.slice(0, 7))).toBe(false);
    expect(hasTrendLine(series)).toBe(true);
  });
});
