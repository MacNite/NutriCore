import { describe, expect, it } from "vitest";
import { targetWithActivity } from "./targets";

describe("targetWithActivity", () => {
  const target = { kcal: 2000, proteinG: 100 };

  it("adds recorded active calories when enabled", () => {
    expect(targetWithActivity(target, 325.5, true)?.kcal).toBe(2325.5);
  });

  it("leaves the base target unchanged when disabled", () => {
    expect(targetWithActivity(target, 325.5, false)).toBe(target);
  });
});
