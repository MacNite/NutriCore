import { describe, expect, it } from "vitest";
import { RateGate, jitter } from "./rate-gate";

describe("RateGate", () => {
  it("hands out the burst immediately and spaces the rest", () => {
    const gate = RateGate.perMinute(10, 2); // one slot every 6s, two back to back
    expect(gate.reserve(Infinity, 0)).toBe(0);
    expect(gate.reserve(Infinity, 0)).toBe(0);
    expect(gate.reserve(Infinity, 0)).toBe(6000);
    expect(gate.reserve(Infinity, 0)).toBe(12_000);
  });

  it("refills as time passes", () => {
    const gate = RateGate.perMinute(10, 1);
    expect(gate.reserve(Infinity, 0)).toBe(0);
    expect(gate.reserve(Infinity, 6000)).toBe(0);
    expect(gate.reserve(Infinity, 6000)).toBe(6000);
  });

  it("reserves nothing when the wait exceeds the caller's budget", () => {
    const gate = RateGate.perMinute(10, 1);
    gate.reserve(Infinity, 0);
    expect(gate.reserve(1000, 0)).toBeNull();
    // The refused caller must not have consumed the slot.
    expect(gate.reserve(Infinity, 0)).toBe(6000);
  });

  it("starts from an empty schedule after a reset", () => {
    const gate = RateGate.perMinute(10, 1);
    gate.reserve(Infinity, 0);
    gate.reset();
    expect(gate.reserve(Infinity, 0)).toBe(0);
  });

  it("spreads a delay around its nominal value", () => {
    expect(jitter(1000, () => 0)).toBe(750);
    expect(jitter(1000, () => 0.5)).toBe(1000);
    expect(jitter(1000, () => 0.999)).toBeLessThanOrEqual(1250);
  });
});
