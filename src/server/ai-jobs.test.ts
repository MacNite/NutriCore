import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, aiJob, aiJobAttempt } = vi.hoisted(() => {
  const aiJob = { findFirst: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
  const aiJobAttempt = { create: vi.fn() };
  return { aiJob, aiJobAttempt, prismaMock: { aiJob, aiJobAttempt, aiProposal: { upsert: vi.fn() }, food: { findFirst: vi.fn() }, $transaction: vi.fn() } };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("./foods", () => ({ visibleFoodWhere: (userId: string) => ({ OR: [{ ownerId: null }, { ownerId: userId }] }) }));
vi.mock("./research", () => ({ fetchResearchSource: vi.fn(), runResearchJob: vi.fn(), failResearchJob: vi.fn() }));
vi.mock("./recipe-import", () => ({ runRecipeImport: vi.fn(), discardRecipeImportImage: vi.fn() }));
vi.mock("./food-enrichment", () => ({ enrichFood: vi.fn(), missingNutritionKeys: vi.fn(() => []) }));

import { claimNextJob, findConservativeDuplicate, mealParseSchema, processNextAiJob, reclaimStaleJobs } from "./ai-jobs";
import { jobPriority, partitionComponents, STUCK_RUNNING_MS } from "./ai-types";
import { failResearchJob, runResearchJob } from "./research";
import { runRecipeImport } from "./recipe-import";

/** An AI provider whose generation always fails, to drive the retry paths. */
const failingAi = {
  capabilities: vi.fn().mockResolvedValue({ model: "qwen3.5:4b" }),
  complete: vi.fn().mockRejectedValue(new Error("ollama unreachable")),
};

function queueJob(overrides: { retryCount?: number; maxRetries?: number; entityType?: string } = {}) {
  const job = {
    id: "job-1",
    userId: "user-1",
    entityType: overrides.entityType ?? "MEAL_INPUT",
    entityId: "entity-1",
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

describe("what the worker picks up next", () => {
  it("takes the highest priority first and only then the oldest", async () => {
    queueJob();
    await claimNextJob();
    expect(aiJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }),
    );
  });

  it("puts background backfilling behind work a user is waiting for", () => {
    expect(jobPriority("FOOD_ENRICHMENT")).toBeLessThan(jobPriority("MEAL_INPUT"));
    expect(jobPriority("MEAL_INPUT")).toBe(jobPriority("RECIPE_LOG"));
  });

  /**
   * A claim is conditional on QUEUED, so a job left RUNNING by a killed worker is
   * never picked up again by anything. Reclaiming is the only way out.
   */
  it("requeues a job left RUNNING by a worker that died", async () => {
    aiJob.updateMany.mockResolvedValue({ count: 2 });
    await expect(reclaimStaleJobs()).resolves.toBe(2);

    const call = aiJob.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ status: "QUEUED", startedAt: null });
    expect(call.where.status).toBe("RUNNING");
    // Only jobs no worker could still legitimately be holding.
    const cutoff = call.where.startedAt.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(STUCK_RUNNING_MS - 1000);
  });

  it("leaves the retry budget alone when reclaiming", async () => {
    aiJob.updateMany.mockResolvedValue({ count: 1 });
    await reclaimStaleJobs();
    expect(aiJob.updateMany.mock.calls[0][0].data.retryCount).toBeUndefined();
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

  it("stops retrying a reason that cannot change, on the first attempt", async () => {
    queueJob({ retryCount: 0, maxRetries: 2 });
    const ai = {
      capabilities: vi.fn().mockResolvedValue({ model: "qwen3.5:4b" }),
      complete: vi.fn().mockRejectedValue(new Error("source-too-large")),
    };
    await processNextAiJob({ ai: ai as never });

    const data = aiJob.update.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(data.failureKind).toBe("SOURCE_TOO_LARGE");
  });

  it("records every attempt with its classified kind", async () => {
    queueJob({ retryCount: 1, maxRetries: 2 });
    await processNextAiJob({ ai: failingAi as never });

    expect(aiJobAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobId: "job-1", attempt: 1, kind: "MODEL_UNREACHABLE" }),
      }),
    );
  });

  it("keeps failing the job when the attempt record cannot be written", async () => {
    queueJob({ retryCount: 0, maxRetries: 2 });
    aiJobAttempt.create.mockRejectedValueOnce(new Error("attempt table missing"));
    await processNextAiJob({ ai: failingAi as never });

    // The job must not be left claimed just because diagnostics failed.
    expect(aiJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED" }) }),
    );
  });
});

describe("features the worker owns", () => {
  /**
   * Research and recipe extraction used to run inline in a server action, where a
   * model call of several minutes could not survive the request.
   */
  it("runs a research job in the worker and completes it", async () => {
    queueJob({ entityType: "RESEARCH" });
    await processNextAiJob();

    expect(runResearchJob).toHaveBeenCalledWith("entity-1", expect.anything());
    expect(aiJob.update.mock.calls[0][0].data.status).toBe("COMPLETED");
  });

  it("runs a recipe extraction in the worker and completes it", async () => {
    queueJob({ entityType: "RECIPE_IMPORT" });
    await processNextAiJob();

    expect(runRecipeImport).toHaveBeenCalledWith("entity-1", expect.anything());
    expect(aiJob.update.mock.calls[0][0].data.status).toBe("COMPLETED");
  });

  /**
   * FAILED is terminal for a research job, so setting it early would block the
   * retry that might still have worked.
   */
  it("only marks the research job failed once no attempt is left", async () => {
    queueJob({ entityType: "RESEARCH", retryCount: 0, maxRetries: 2 });
    vi.mocked(runResearchJob).mockRejectedValueOnce(new Error("ollama unreachable"));
    await processNextAiJob();
    expect(failResearchJob).not.toHaveBeenCalled();

    queueJob({ entityType: "RESEARCH", retryCount: 2, maxRetries: 2 });
    vi.mocked(runResearchJob).mockRejectedValueOnce(new Error("ollama unreachable"));
    await processNextAiJob();
    expect(failResearchJob).toHaveBeenCalledWith("entity-1");
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
