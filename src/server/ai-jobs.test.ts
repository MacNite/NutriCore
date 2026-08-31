import { describe, expect, it } from "vitest";
import { findConservativeDuplicate, mealParseSchema } from "./ai-jobs";

describe("AI enrichment boundaries",()=>{
  it("rejects malformed structured model output",()=>{
    expect(mealParseSchema.safeParse({components:[{name:"egg",estimatedGrams:-2}],confidence:"certain"}).success).toBe(false);
  });
  it("only auto-links exact normalized duplicate names",()=>{
    const foods=[{id:"1",normalizedName:"greek yogurt"}];
    expect(findConservativeDuplicate("Greek yogurt",foods)?.id).toBe("1");
    expect(findConservativeDuplicate("yogurt Greek style",foods)).toBeNull();
  });
});
