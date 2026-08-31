import { describe, expect, it } from "vitest";
import { shiftDateKey, validDateKey } from "./date";

describe("date keys", () => {
  it("validates real calendar dates and falls back for invalid input", () => {
    expect(validDateKey("2026-08-30", "2020-01-01")).toBe("2026-08-30");
    expect(validDateKey("2026-02-31", "2020-01-01")).toBe("2020-01-01");
  });
  it("shifts exactly one UTC calendar day", () => {
    expect(shiftDateKey("2026-08-30", -1)).toBe("2026-08-29");
    expect(shiftDateKey("2026-08-30", 1)).toBe("2026-08-31");
  });
});
