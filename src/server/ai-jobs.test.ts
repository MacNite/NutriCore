import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, aiJob } = vi.hoisted(() => {
  const aiJob = { findFirst: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
  return { aiJob, prismaMock: { aiJob, aiProposal: { upsert: vi.fn() }, food: { findFirst: vi.fn() }, $transaction: vi.fn() } };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("./foods", () => ({ visibleFoodWhere: (userId: string) => ({ OR: [{ ownerId: null }, { ownerId: userId }] }) }));
vi.mock("./research", () => ({ fetchResearchSource: vi.fn() }));

import { claimNextJob, findConservativeDuplicate, mealParseSchema, processNextAiJob } from "./ai-jobs";
import { partitionComponents } from "./ai-types";

/** An AI provider whose generation always fails, to drive the retry paths. */
const failingAi = {
  capabilities: vi.fn().mockResolvedValue({ model: "qwen3.5:4b" }),
  complete: vi.fn().mockRejectedValue(new Error("ollama unreachable")),
};

function queueJob(overrides: { retryCount?: number; maxRetries?: number } = {}) {
  const job = {
    id: "job-1",
    userId: "user-1",
    entityType: "MEAL_INPUT",
    status: "RUNNING",
    retryCount: overrides.retryCount ?? 0,
    maxRetries: overrides.maxRetries ?? 2,
    mealInput: { id: "input-1", text: "two eggs", sourceUrl: null, meal: "BREAKFAST", diaryDate: new Date() },
  };
  aiJob.findFirst.mockResolvedValue({ id: job.id });
  aiJob.updateMany.mockResolvedValue({ count: 1 });
  aiJob.findUnique.mockResolvedValue(job);
  return job;
}

beforeEach(() => vi.clearAllMocks());

describe("AI enrichment boundaries", () => {
  it("rejects malformed structured model output", () => {
    expect(mealParseSchema.safeParse({ components: [{ name: "egg", estimatedGrams: -2 }], confidence: "certain" }).success).toBe(false);
  });

  it("only auto-links exact normalized duplicate names", () => {
    const foods = [{ id: "1", normalizedName: "greek yogurt" }];
    expect(findConservativeDuplicate("Greek yogurt", foods)?.id).toBe("1");
    expect(findConservativeDuplicate("yogurt Greek style", foods)).toBeNull();
  });
});

describe("AI job retry budget", () => {
  it("does not count a first attempt as a retry", async () => {
    queueJob();
    await claimNextJob();
    expect(aiJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ retryCount: expect.anything() }) }),
    );
  });

  it("requeues a failed job while its budget lasts", async () => {
    queueJob({ retryCount: 0, maxRetries: 2 });
    await processNextAiJob({ ai: failingAi as never });

    expect(aiJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "QUEUED", retryCount: { increment: 1 }, errorMessage: "ollama unreachable" }),
      }),
    );
  });

  it("fails a job for good once the budget is spent", async () => {
    queueJob({ retryCount: 2, maxRetries: 2 });
    await processNextAiJob({ ai: failingAi as never });

    const data = aiJob.update.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(data.failedAt).toBeInstanceOf(Date);
    expect(data.retryCount).toBeUndefined();
  });
});

describe("what an approved proposal may log", () => {
  it("logs only components with both a matched food and a weight", () => {
    const { loggable, skipped } = partitionComponents([
      { name: "egg", canonicalFoodId: "food-1", estimatedGrams: 120 },
      { name: "grandma's secret sauce", canonicalFoodId: null, estimatedGrams: 30 },
      { name: "rye bread", canonicalFoodId: "food-2" },
      { name: "water", canonicalFoodId: "food-3", estimatedGrams: 0 },
    ]);

    expect(loggable.map((c) => c.name)).toEqual(["egg"]);
    expect(skipped).toEqual(["grandma's secret sauce", "rye bread", "water"]);
  });
});
