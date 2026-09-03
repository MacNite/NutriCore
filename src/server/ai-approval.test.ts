import { describe, expect, it } from "vitest";
import { ingestionOptions } from "./ai-types";
describe("recipe approval boundary", () => {
  it("delays logging only when a recipe will be confirmed", () => expect(ingestionOptions(true, true)).toEqual({ intent: "RECIPE", logAfterConfirm: true }));
});
