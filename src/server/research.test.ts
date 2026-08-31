import { describe, expect, it } from "vitest";
import { validateReferenceUrl } from "./research";

describe("research source storage validation", () => {
  it("accepts http(s) references without DNS and rejects unsafe syntax", () => {
    expect(validateReferenceUrl("https://example.org/recipe")).toBe("https://example.org/recipe");
    expect(validateReferenceUrl("javascript:alert(1)")).toBeNull();
    expect(validateReferenceUrl("https://user:secret@example.org")).toBeNull();
  });
});
