import { describe, expect, it } from "vitest";
import { ageInYears } from "./body";

describe("age in years", () => {
  const now = new Date(Date.UTC(2026, 8, 2));

  it("counts whole years", () => {
    expect(ageInYears(new Date(Date.UTC(1992, 0, 1)), now)).toBe(34);
  });

  it("does not count a birthday that has not happened yet this year", () => {
    expect(ageInYears(new Date(Date.UTC(1992, 8, 3)), now)).toBe(33);
    expect(ageInYears(new Date(Date.UTC(1992, 8, 2)), now)).toBe(34);
    expect(ageInYears(new Date(Date.UTC(1992, 9, 1)), now)).toBe(33);
  });

  it("has no answer without a birth date, which is what withholds RFM", () => {
    expect(ageInYears(null, now)).toBeNull();
  });
});
