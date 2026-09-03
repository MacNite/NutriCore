import { describe, expect, it, vi } from "vitest";

// `mealParseSchema` is the contract these repairs have to satisfy, and it lives
// with the worker. Importing it would otherwise construct a Prisma client for a
// suite that never touches a database.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { researchResultSchema } from "@/lib/research";
import { mealParseSchema } from "./ai-jobs";
import { decideComponents, type ProposedComponent } from "./ai-types";
import { extractedRecipeSchema } from "./ai-ingestion";
import {
  confidenceBand,
  ingredientFromText,
  positiveOrAbsent,
  repairExtractedRecipe,
  repairMealParse,
  repairNutrientExtraction,
  repairResearchResult,
} from "./ai-repair";

describe("repairing a meal parse", () => {
  /** The exact shape that used to fail the whole job in production. */
  const modelAnswer = {
    components: [
      { name: "Rührei", quantity: 2, unit: "Stück", estimatedGrams: 0 },
      { name: "Vollkornbrot", quantity: 0, unit: "Scheibe", estimatedGrams: 0 },
      { name: "Butter", quantity: 0, unit: "g", estimatedGrams: 0 },
    ],
    confidence: "medium",
    warnings: [],
  };

  it("keeps a meal that only lacked the weights", () => {
    const result = mealParseSchema.safeParse(repairMealParse(modelAnswer));
    expect(result.success).toBe(true);
    expect(result.success && result.data.components.map((c) => c.name)).toEqual([
      "Rührei",
      "Vollkornbrot",
      "Butter",
    ]);
  });

  it("rejects the same answer without repair, which is what happened before", () => {
    expect(mealParseSchema.safeParse(modelAnswer).success).toBe(false);
  });

  it("removes the unusable value rather than inventing one", () => {
    const result = mealParseSchema.parse(repairMealParse(modelAnswer));
    expect(result.components[0].estimatedGrams).toBeUndefined();
    // Which means the component is still reported as skipped, not logged.
    const { loggable, skipped } = decideComponents(result.components as ProposedComponent[]);
    expect(loggable).toHaveLength(0);
    expect(skipped).toEqual(["Rührei", "Vollkornbrot", "Butter"]);
  });

  it("keeps the dish name the model gave the whole meal", () => {
    const result = mealParseSchema.parse(
      repairMealParse({ ...modelAnswer, name: "  Rührei mit Brot  " }),
    );
    expect(result.name).toBe("Rührei mit Brot");
  });

  it("leaves the dish name absent when the model gave none", () => {
    // The schema allows that, and the quick meal then falls back to the text
    // the user typed rather than to a name nobody stated.
    expect(mealParseSchema.parse(repairMealParse({ ...modelAnswer, name: "   " })).name).toBeUndefined();
    expect(mealParseSchema.parse(repairMealParse(modelAnswer)).name).toBeUndefined();
  });

  it("keeps the weights it can use", () => {
    const result = mealParseSchema.parse(
      repairMealParse({
        components: [{ name: "Haferflocken", quantity: 80, unit: "g", estimatedGrams: 80 }],
        confidence: "high",
      }),
    );
    expect(result.components[0].estimatedGrams).toBe(80);
    expect(result.confidence).toBe("high");
  });

  it("recovers a per-item gram estimate the model embedded in the unit", () => {
    const result = mealParseSchema.parse(
      repairMealParse({
        components: [
          { name: "Brot", quantity: 2, unit: "Scheiben (approx. 50g)" },
          { name: "Mett", quantity: 1, unit: "Portion (ca. 40 g)" },
        ],
        confidence: "medium",
      }),
    );

    expect(result.components).toEqual([
      { name: "Brot", quantity: 2, unit: "Scheiben", estimatedGrams: 100 },
      { name: "Mett", quantity: 1, unit: "Portion", estimatedGrams: 40 },
    ]);
  });

  it("does not overwrite an explicit structured gram estimate", () => {
    const result = mealParseSchema.parse(
      repairMealParse({
        components: [{ name: "Brot", quantity: 2, unit: "Scheiben (ca. 50 g)", estimatedGrams: 90 }],
        confidence: "high",
      }),
    );

    expect(result.components[0]).toEqual({ name: "Brot", quantity: 2, unit: "Scheiben", estimatedGrams: 90 });
  });

  it("drops a component with no name and an over-long list", () => {
    const result = mealParseSchema.parse(
      repairMealParse({
        components: [{ name: "   ", estimatedGrams: 10 }, { name: "Reis", estimatedGrams: 150 }, "nonsense"],
        confidence: "low",
      }),
    );
    expect(result.components.map((c) => c.name)).toEqual(["Reis"]);
  });

  it("reads a decimal comma and refuses an absurd magnitude", () => {
    expect(positiveOrAbsent("12,5", 10000)).toBe(12.5);
    expect(positiveOrAbsent(99999999, 10000)).toBeUndefined();
    expect(positiveOrAbsent("not a number", 10000)).toBeUndefined();
  });

  it("downgrades a confidence the model spelt its own way", () => {
    expect(confidenceBand("HIGH")).toBe("high");
    expect(confidenceBand("certain")).toBe("low");
    expect(confidenceBand(0.9)).toBe("low");
  });
});

describe("repairing a nutrient extraction", () => {
  const repair = repairNutrientExtraction(["energyKcal", "protein", "fiber"]);

  it("keeps only the keys that were asked for", () => {
    const result = repair({ nutrients: { energyKcal: 240, protein: 8.1, vitaminQ: 5, fat: 3 } }) as {
      nutrients: Record<string, number>;
    };
    expect(Object.keys(result.nutrients).sort()).toEqual(["energyKcal", "protein"]);
  });

  it("drops negative values while preserving raw source magnitudes for later validation", () => {
    const result = repair({ nutrients: { protein: -4, fiber: 1200, energyKcal: 310 } }) as {
      nutrients: Record<string, number>;
    };
    expect(result.nutrients).toEqual({ fiber: 1200, energyKcal: 310 });
  });

  it("drops a serving size of zero instead of storing it", () => {
    const result = repair({ nutrients: {}, servingSizeG: 0 }) as { servingSizeG?: number };
    expect(result.servingSizeG).toBeUndefined();
  });
});

describe("repairing a research result", () => {
  it("accepts an answer with a bad unit and a zero-amount ingredient", () => {
    const parsed = researchResultSchema.safeParse(
      repairResearchResult({
        kind: "recipe",
        name: "Linsensuppe",
        language: "de",
        ingredients: [
          { name: "Linsen", amount: 200, unit: "gramm", confidence: 0.8 },
          { name: "Salz", amount: 0, unit: "g", confidence: 0.5 },
        ],
        servings: 4,
        confidence: 0.7,
      }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.ingredients).toEqual([
      { name: "Linsen", amount: 200, unit: "g", confidence: 0.8 },
    ]);
  });

  it("drops an incomplete nutrition block instead of zero-filling it", () => {
    const repaired = repairResearchResult({
      kind: "food",
      name: "Apfel",
      language: "de",
      ingredients: [{ name: "Apfel", amount: 100, unit: "g", confidence: 1 }],
      servings: 1,
      confidence: 0.5,
      // No fat: an understated dish is worse than no numbers at all.
      nutritionPer100g: { energyKcal: 52, protein: 0.3, carbohydrate: 14 },
    }) as { nutritionPer100g?: unknown };
    expect(repaired.nutritionPer100g).toBeUndefined();
    expect(researchResultSchema.safeParse(repaired).success).toBe(true);
  });

  it("discards a source URL the model made up in the wrong shape", () => {
    const repaired = repairResearchResult({
      kind: "food",
      name: "Reis",
      language: "de",
      ingredients: [{ name: "Reis", amount: 100, unit: "g", confidence: 1 }],
      servings: 1,
      confidence: 0.5,
      sources: [{ title: "Quelle", url: "not-a-url" }, { title: "Ok", url: "https://example.org/reis" }],
    }) as { sources: { url: string }[] };
    expect(repaired.sources.map((s) => s.url)).toEqual(["https://example.org/reis"]);
  });
});

describe("repairing an imported recipe", () => {
  const repaired = (answer: unknown) => extractedRecipeSchema.safeParse(repairExtractedRecipe(answer));

  it("reads an ingredient list the model returned as strings", () => {
    // Plain JSON mode leaves the shape to the model, and this answer used to be
    // dropped entry by entry until the empty array failed validation.
    const result = repaired({
      name: "Auflauf",
      ingredients: ["200 g Mehl", "1,5 EL Öl", "½ TL Salz", "2 Eier", "Pfeffer nach Geschmack"],
    });

    expect(result.success && result.data.ingredients).toEqual([
      { name: "Mehl", amount: 200, unit: "g" },
      { name: "Öl", amount: 1.5, unit: "EL" },
      { name: "Salz", amount: 0.5, unit: "TL" },
      // Counted, not weighed: two eggs are not two grams.
      { name: "Eier", amount: 2, unit: "piece" },
    ]);
  });

  it("accepts the field names a model picks for itself", () => {
    const result = repaired({
      name: "Suppe",
      zutaten: [
        { ingredient: "Karotten", quantity: "2", unit: "Stück" },
        { item: "Brühe", menge: "500 ml" },
        { name: "300 g Kartoffeln" },
      ],
    });

    expect(result.success && result.data.ingredients).toEqual([
      { name: "Karotten", amount: 2, unit: "Stück" },
      { name: "Brühe", amount: 500, unit: "ml" },
      { name: "Kartoffeln", amount: 300, unit: "g" },
    ]);
  });

  it("still drops an ingredient whose quantity nobody stated", () => {
    expect(ingredientFromText("Salz nach Geschmack")).toBeUndefined();
    expect(repaired({ name: "Salat", ingredients: [{ name: "Salz" }] }).success).toBe(false);
  });

  it("leaves a well-formed answer exactly as the model wrote it", () => {
    const result = repaired({
      name: "Auflauf",
      servings: 4,
      instructions: "Mischen und backen.",
      ingredients: [{ name: "Mehl", amount: 200, unit: "g" }],
    });

    expect(result.success && result.data).toMatchObject({
      servings: 4,
      instructions: "Mischen und backen.",
      ingredients: [{ name: "Mehl", amount: 200, unit: "g" }],
    });
  });
});
