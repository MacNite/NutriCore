/**
 * Who may decide a proposal, and what deciding actually does to the food.
 *
 * The permission rules here are the reason the queue is split in two rather
 * than pooled, so they are asserted directly rather than inferred from the two
 * pages that call them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { prismaMock, enrichmentProposal, enrichmentProposalValue, foodNutrient, food, foodSource } = vi.hoisted(() => {
  const enrichmentProposal = { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() };
  const enrichmentProposalValue = { findMany: vi.fn(), update: vi.fn() };
  const foodNutrient = { updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(), deleteMany: vi.fn(async () => ({ count: 1 })) };
  const food = { updateMany: vi.fn(async () => ({ count: 1 })) };
  const foodSource = { create: vi.fn() };
  const tx = { enrichmentProposal, enrichmentProposalValue, foodNutrient, food, foodSource };
  return {
    enrichmentProposal,
    enrichmentProposalValue,
    foodNutrient,
    food,
    foodSource,
    prismaMock: { ...tx, $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)) },
  };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { applyReview, mayReview } from "./enrichment-review";

const proposal = { id: "p-1", foodId: "food-1", sourceUrl: "https://a.test", model: "qwen3.5:4b", servingSizeG: null };

beforeEach(() => {
  vi.clearAllMocks();
  foodNutrient.updateMany.mockResolvedValue({ count: 0 });
  foodNutrient.deleteMany.mockResolvedValue({ count: 1 });
  food.updateMany.mockResolvedValue({ count: 1 });
  enrichmentProposal.findUniqueOrThrow.mockResolvedValue(proposal);
});

describe("who may review a proposal", () => {
  const asAdmin = { id: "admin-1", isAdmin: true };
  const asOwner = { id: "user-2", isAdmin: false };

  it("lets an administrator decide the shared catalogue", async () => {
    enrichmentProposal.findUnique.mockResolvedValue({ id: "p-1", foodId: "food-1", food: { ownerId: null } });
    expect(await mayReview("p-1", asAdmin)).not.toBeNull();
  });

  it("does not let an administrator decide a food somebody owns", async () => {
    // They cannot read that food anywhere else in the app; a review queue is no
    // reason to start. This is the whole reason the queue is split.
    enrichmentProposal.findUnique.mockResolvedValue({ id: "p-1", foodId: "food-1", food: { ownerId: "user-2" } });
    expect(await mayReview("p-1", asAdmin)).toBeNull();
  });

  it("lets the owner decide their own food, and nobody else's", async () => {
    enrichmentProposal.findUnique.mockResolvedValue({ id: "p-1", foodId: "food-1", food: { ownerId: "user-2" } });
    expect(await mayReview("p-1", asOwner)).not.toBeNull();
    expect(await mayReview("p-1", { id: "user-3", isAdmin: false })).toBeNull();
  });

  it("does not let an ordinary user decide the shared catalogue", async () => {
    enrichmentProposal.findUnique.mockResolvedValue({ id: "p-1", foodId: "food-1", food: { ownerId: null } });
    expect(await mayReview("p-1", asOwner)).toBeNull();
  });

  it("treats a proposal that does not exist as one nobody may decide", async () => {
    enrichmentProposal.findUnique.mockResolvedValue(null);
    expect(await mayReview("missing", asAdmin)).toBeNull();
  });
});

describe("applying a decision", () => {
  it("writes an approved value only into a gap, never over an existing one", async () => {
    enrichmentProposalValue.findMany.mockResolvedValue([
      { id: "v-1", nutrientKey: "iron", value: 0.4, applied: false },
    ]);
    // Somebody filled it in the meantime, so the conditional update matches
    // nothing and the create collides - their value has to stand.
    foodNutrient.updateMany.mockResolvedValue({ count: 0 });
    foodNutrient.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6" }));

    const result = await applyReview("p-1", "admin-1", { approve: ["v-1"] });

    expect(foodNutrient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { foodId: "food-1", nutrientKey: "iron", value: null } }),
    );
    // The decision is still recorded even though the write lost the race.
    expect(result.approved).toBe(1);
  });

  it("takes a refused value back off the food, matching only what the AI wrote", async () => {
    enrichmentProposalValue.findMany.mockResolvedValue([
      { id: "v-1", nutrientKey: "iron", value: 0.4, applied: true },
    ]);

    const result = await applyReview("p-1", "user-2", { reject: ["v-1"] });

    // Scoped by origin: a value a dataset has since supplied must not be deleted
    // by somebody refusing the model's older guess at the same nutrient.
    expect(foodNutrient.deleteMany).toHaveBeenCalledWith({
      where: { foodId: "food-1", nutrientKey: "iron", origin: "AI_ENRICHMENT" },
    });
    expect(enrichmentProposalValue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED", applied: false }) }),
    );
    expect(result.rejected).toBe(1);
  });

  it("keeps an already-applied value without rewriting it", async () => {
    // The retro-review rows: written before review existed, approving is a
    // decision about something already in use, not a fresh write.
    enrichmentProposalValue.findMany.mockResolvedValue([
      { id: "v-1", nutrientKey: "iron", value: 0.4, applied: true },
    ]);

    await applyReview("p-1", "admin-1", { approve: ["v-1"] });

    expect(foodNutrient.updateMany).not.toHaveBeenCalled();
    expect(foodNutrient.create).not.toHaveBeenCalled();
    expect(foodNutrient.deleteMany).not.toHaveBeenCalled();
  });

  it("cites a source only for values somebody accepted", async () => {
    enrichmentProposalValue.findMany.mockResolvedValue([
      { id: "v-1", nutrientKey: "iron", value: 0.4, applied: false },
      { id: "v-2", nutrientKey: "calcium", value: 120, applied: true },
    ]);
    foodNutrient.updateMany.mockResolvedValue({ count: 1 });

    await applyReview("p-1", "admin-1", { approve: ["v-1"], reject: ["v-2"] });

    expect(foodSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ url: "https://a.test", metadata: expect.objectContaining({ nutrientKeys: ["iron"] }) }),
      }),
    );
  });

  it("writes no source row when everything was refused", async () => {
    enrichmentProposalValue.findMany.mockResolvedValue([
      { id: "v-1", nutrientKey: "iron", value: 0.4, applied: true },
    ]);

    await applyReview("p-1", "admin-1", { reject: ["v-1"] });

    expect(foodSource.create).not.toHaveBeenCalled();
  });

  it("applies an approved serving weight only when the food still has none", async () => {
    enrichmentProposal.findUniqueOrThrow.mockResolvedValue({ ...proposal, servingSizeG: 30 });
    enrichmentProposalValue.findMany.mockResolvedValue([]);

    await applyReview("p-1", "admin-1", { serving: "APPROVE" });

    expect(food.updateMany).toHaveBeenCalledWith({
      where: { id: "food-1", servingSize: null },
      data: { servingSize: 30, servingUnit: "g" },
    });
  });

  it("does nothing at all when the decision is empty", async () => {
    const result = await applyReview("p-1", "admin-1", {});
    expect(result).toEqual({ approved: 0, rejected: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
