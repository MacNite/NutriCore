/**
 * What a report may be filed against, and what deciding one does to the food.
 *
 * Two rules carry the whole feature and neither is visible from the pages that
 * call it: only a food nobody owns can be reported, and accepting a value
 * *overwrites* what the catalogue said. Both are asserted here directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, food, foodNutrient, foodReport, foodReportValue, foodSource } = vi.hoisted(() => {
  const food = { findFirst: vi.fn(), update: vi.fn() };
  const foodNutrient = { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() };
  const foodReport = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() };
  const foodReportValue = { findMany: vi.fn(), update: vi.fn() };
  const foodSource = { create: vi.fn() };
  const tx = { food, foodNutrient, foodReport, foodReportValue, foodSource };
  return {
    food,
    foodNutrient,
    foodReport,
    foodReportValue,
    foodSource,
    prismaMock: { ...tx, $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)) },
  };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { FoodReportError, decideFoodReport, submitFoodReport } from "./food-reports";

const openReport = {
  id: "r-1",
  foodId: "food-1",
  status: "OPEN" as const,
  sourceUrl: "https://label.test",
  servingSize: null,
  servingStatus: "OPEN" as const,
  food: { basisUnit: "G" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  food.findFirst.mockResolvedValue({ id: "food-1" });
  foodNutrient.findMany.mockResolvedValue([]);
  foodNutrient.findUnique.mockResolvedValue(null);
  foodReport.findFirst.mockResolvedValue(null);
  foodReport.findUnique.mockResolvedValue(openReport);
  foodReportValue.findMany.mockResolvedValue([]);
  foodReport.create.mockResolvedValue({ id: "r-1" });
});

describe("filing a report", () => {
  const input = { comment: null, sourceUrl: null, servingSize: null, values: [{ nutrientKey: "energyKcal", value: 535 }] };

  it("refuses a food that is not in the shared catalogue", async () => {
    // The query is what enforces it: a food somebody owns does not match, so a
    // report can never reach an administrator who could not read the food.
    food.findFirst.mockResolvedValue(null);
    await expect(submitFoodReport("user-1", "food-1", input)).rejects.toMatchObject({ reason: "notReportable" });
    expect(food.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "food-1", ownerId: null } }));
  });

  it("refuses a second open report on the same food from the same person", async () => {
    foodReport.findFirst.mockResolvedValue({ id: "r-0" });
    await expect(submitFoodReport("user-1", "food-1", input)).rejects.toBeInstanceOf(FoodReportError);
  });

  it("snapshots what the food said, so a reviewer sees what was disputed", async () => {
    foodNutrient.findMany.mockResolvedValue([{ nutrientKey: "energyKcal", value: 53 }]);
    await submitFoodReport("user-1", "food-1", input);
    expect(foodReport.create.mock.calls[0][0].data.values.createMany.data).toEqual([
      { nutrientKey: "energyKcal", currentValue: 53, proposedValue: 535 },
    ]);
  });

  it("drops a proposed value that is already the stored one", async () => {
    // Half-filled forms produce these. They are not corrections, and a report
    // left with nothing else to say is refused rather than queued empty.
    foodNutrient.findMany.mockResolvedValue([{ nutrientKey: "energyKcal", value: 535 }]);
    await expect(submitFoodReport("user-1", "food-1", input)).rejects.toMatchObject({ reason: "empty" });
  });

  it("takes a report that only describes the problem in words", async () => {
    await submitFoodReport("user-1", "food-1", { ...input, values: [], comment: "  This is the drained weight.  " });
    expect(foodReport.create.mock.calls[0][0].data.comment).toBe("This is the drained weight.");
  });

  it("ignores a nutrient key the catalogue does not define", async () => {
    await expect(
      submitFoodReport("user-1", "food-1", { ...input, values: [{ nutrientKey: "unobtainium", value: 1 }] }),
    ).rejects.toMatchObject({ reason: "empty" });
  });
});

describe("deciding a report", () => {
  const value = { id: "v-1", nutrientKey: "energyKcal", proposedValue: 535 };

  it("overwrites the value the catalogue supplied, and says what it replaced", async () => {
    // The opposite of enrichment, which only ever fills a gap: here the stored
    // number is precisely what is being disputed.
    foodReportValue.findMany.mockResolvedValue([value]);
    foodNutrient.findUnique.mockResolvedValue({ value: 53 });

    const outcome = await decideFoodReport("r-1", "admin-1", { accept: [{ id: "v-1", value: 535 }] });

    expect(foodNutrient.upsert.mock.calls[0][0].update).toMatchObject({ value: 535, origin: "USER_REPORT" });
    expect(outcome).toMatchObject({ foodId: "food-1", accepted: 1, rejected: 0 });
    expect(foodSource.create.mock.calls[0][0].data.metadata).toMatchObject({
      reportId: "r-1",
      nutrientKeys: ["energyKcal"],
      replaced: { energyKcal: 53 },
    });
  });

  it("writes the reviewer's own number when they revise the proposal", async () => {
    foodReportValue.findMany.mockResolvedValue([value]);
    await decideFoodReport("r-1", "admin-1", { accept: [{ id: "v-1", value: 528 }] });
    expect(foodNutrient.upsert.mock.calls[0][0].update).toMatchObject({ value: 528 });
    expect(foodReportValue.update.mock.calls[0][0].data).toMatchObject({ status: "ACCEPTED", decidedValue: 528 });
  });

  it("leaves the food alone when nothing is accepted, and closes the report", async () => {
    foodReportValue.findMany.mockResolvedValue([value]);
    const outcome = await decideFoodReport("r-1", "admin-1", { reject: ["v-1"], note: "Matches the label." });

    expect(foodNutrient.upsert).not.toHaveBeenCalled();
    expect(foodSource.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ accepted: 0, rejected: 1 });
    expect(foodReport.update.mock.calls[0][0].data).toMatchObject({ status: "REJECTED", reviewNote: "Matches the label." });
  });

  it("does nothing to a report that has already been decided", async () => {
    // Deciding twice would overwrite the food a second time with numbers
    // nobody looked at again.
    foodReport.findUnique.mockResolvedValue({ ...openReport, status: "ACCEPTED" });
    const outcome = await decideFoodReport("r-1", "admin-1", { accept: [{ id: "v-1", value: 535 }] });
    expect(outcome).toEqual({ foodId: null, accepted: 0, rejected: 0, servingApplied: false });
    expect(foodNutrient.upsert).not.toHaveBeenCalled();
  });

  it("writes an accepted serving weight in the food's own basis unit", async () => {
    foodReport.findUnique.mockResolvedValue({ ...openReport, servingSize: 250, food: { basisUnit: "ML" } });
    const outcome = await decideFoodReport("r-1", "admin-1", { serving: "ACCEPT" });
    expect(food.update.mock.calls[0][0].data).toEqual({ servingSize: 250, servingUnit: "ml" });
    expect(outcome.servingApplied).toBe(true);
  });

  it("never touches a serving weight the report did not propose", async () => {
    await decideFoodReport("r-1", "admin-1", { serving: "ACCEPT" });
    expect(food.update).not.toHaveBeenCalled();
  });
});
