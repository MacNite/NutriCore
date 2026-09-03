import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, aiJob, aiJobAttempt, user } = vi.hoisted(() => {
  const aiJob = { findFirst: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
  const aiJobAttempt = { create: vi.fn() };
  const user = {
    findUnique: vi.fn(async () => ({ profile: { language: "de", researchEnabled: false, autoApproveAi: true } })),
  };
  // The worker reads the created proposal out of the transaction result.
  const mealInput = { update: vi.fn(), updateMany: vi.fn() };
  const $transaction = vi.fn(async (operations: unknown[]) => operations.length === 2 ? [{ id: "proposal-1" }, {}] : []);
  return {
    aiJob,
    aiJobAttempt,
    user,
    prismaMock: { aiJob, aiJobAttempt, user, aiIngestionInput: mealInput, aiProposal: { upsert: vi.fn() }, food: { findFirst: vi.fn() }, $transaction },
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
// The worker resolves a component through `component-resolver` now, which pulls
// the whole food-search pipeline. These tests drive the retry paths, so the
// resolver is stubbed rather than exercised here.
vi.mock("./component-resolver", () => ({
  resolveComponent: vi.fn(async () => ({ candidates: [], selectedFoodId: null, grams: null, gramsSource: "NONE" })),
}));
vi.mock("./research", () => ({ fetchResearchSource: vi.fn(), runResearchJob: vi.fn(), failResearchJob: vi.fn() }));
vi.mock("./meal-url", () => ({
  fetchMealPage: vi.fn(async (url: string) => ({ url, title: "Soup", excerpt: "Ingredients: 2 carrots", recipeFound: true })),
  mealPagePrompt: vi.fn((page: { excerpt: string }, text: string) => `${text}\nUNTRUSTED:${page.excerpt}`),
}));
vi.mock("./ai-ingestion", () => ({ runRecipeImport: vi.fn(), discardRecipeImportImage: vi.fn() }));
vi.mock("./food-enrichment", () => ({ enrichFood: vi.fn(), missingNutritionKeys: vi.fn(() => []) }));
vi.mock("./ai-approval", () => ({ autoApproveProposal: vi.fn() }));
vi.mock("./meal-image", () => ({ discardMealInputImage: vi.fn() }));

import { claimNextJob, findConservativeDuplicate, mealParseSchema, processNextAiJob, reclaimStaleJobs, scaleMealComponentsToServing } from "./ai-jobs";
import { decideComponents, jobPriority, STUCK_RUNNING_MS } from "./ai-types";
import { failResearchJob, runResearchJob } from "./research";
import { runRecipeImport } from "./ai-ingestion";
import { resolveComponent } from "./component-resolver";
import { autoApproveProposal } from "./ai-approval";
import { fetchMealPage, mealPagePrompt } from "./meal-url";

/** An AI provider whose generation always fails, to drive the retry paths. */
const failingAi = {
  capabilities: vi.fn().mockResolvedValue({ model: "qwen3.5:4b" }),
  complete: vi.fn().mockRejectedValue(new Error("ollama unreachable")),
};

function queueJob(overrides: { retryCount?: number; maxRetries?: number; entityType?: string } = {}) {
  const job = {
    id: "job-1",
    userId: "user-1",
    entityType: overrides.entityType ?? "AI_INGESTION",
    entityId: "entity-1",
    status: "RUNNING",
    retryCount: overrides.retryCount ?? 0,
    maxRetries: overrides.maxRetries ?? 2,
    metadata: null,
    ingestionInput: { intent: "MEAL", id: "input-1", text: "two eggs", sourceUrl: null as string | null, imageData: null as Buffer | null, imageMime: null, meal: "BREAKFAST", diaryDate: new Date() },
  };
  aiJob.findFirst.mockResolvedValue({ id: job.id });
  aiJob.updateMany.mockResolvedValue({ count: 1 });
  aiJob.findUnique.mockResolvedValue(job);
  return job;
}

beforeEach(() => vi.clearAllMocks());

describe("AI enrichment boundaries", () => {
  it("scales a whole recipe extraction to one quick-meal serving", () => {
    const result = scaleMealComponentsToServing({
      components: [{ name: "Soup", quantity: 1200, unit: "g", estimatedGrams: 1200 }],
      confidence: "high",
      warnings: [],
    }, 4);
    expect(result.components[0]).toMatchObject({ quantity: 300, estimatedGrams: 300 });
  });

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
    const job = queueJob({ entityType: "AI_INGESTION" });
    job.ingestionInput.intent = "RECIPE";
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

describe("applying a proposal without the review screen", () => {
  /** A parse the worker can carry all the way to a proposal. */
  const workingAi = () => ({
    capabilities: vi.fn().mockResolvedValue({ model: "qwen3.5:4b" }),
    complete: vi.fn().mockResolvedValue({
      components: [{ name: "Brot", quantity: 2, unit: "Scheiben" }],
      confidence: "medium",
      warnings: [],
    }),
  });

  it("feeds URL-only ingredients into the same component resolver and proposal path", async () => {
    const job = queueJob();
    job.ingestionInput.text = "";
    job.ingestionInput.sourceUrl = "https://recipes.example/soup";
    const ai = workingAi();
    await processNextAiJob({ ai: ai as never });

    expect(fetchMealPage).toHaveBeenCalledWith(job.ingestionInput.sourceUrl);
    expect(mealPagePrompt).toHaveBeenCalledWith(expect.objectContaining({ recipeFound: true }), "");
    expect(resolveComponent).toHaveBeenCalledWith(expect.objectContaining({ name: "Brot" }), expect.anything());
    const proposal = prismaMock.aiProposal.upsert.mock.calls[0][0];
    expect(proposal.create.provenance).toMatchObject({ inputKind: "url", sourceUrl: job.ingestionInput.sourceUrl });
    expect(JSON.stringify(proposal.create.proposed)).not.toContain("Ingredients: 2 carrots");
  });

  it("sends image bytes to the configured provider, then clears them after structured extraction", async () => {
    const job = queueJob();
    job.ingestionInput.text = "with extra avocado";
    job.ingestionInput.imageData = Buffer.from("private-image");
    const ai = workingAi();

    await processNextAiJob({ ai: ai as never });

    expect(ai.complete).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "with extra avocado",
      images: [Buffer.from("private-image").toString("base64")],
    }));
    expect(prismaMock.aiIngestionInput.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { imageData: null, imageMime: null, imageExpiresAt: null },
    }));
    const proposalJson = JSON.stringify(prismaMock.aiProposal.upsert.mock.calls.at(-1));
    expect(proposalJson).not.toContain(Buffer.from("private-image").toString("base64"));
    expect(proposalJson).toContain('"inputKind":"text+image"');
  });

  /**
   * The review screen was only reachable through the redirect that followed
   * submitting a meal, so a proposal nobody reviewed at once was a meal that
   * never reached the diary.
   */
  it("applies the proposal when the user asked not to review every meal", async () => {
    queueJob();
    vi.mocked(resolveComponent).mockResolvedValue({
      candidates: [],
      selectedFoodId: "food-1",
      grams: 60,
      gramsSource: "PORTION",
    });

    await processNextAiJob({ ai: workingAi() as never });
    expect(autoApproveProposal).toHaveBeenCalledWith("proposal-1");
  });

  /**
   * The recipe used to be written here, from whatever the resolver had matched
   * on its own - before anyone had reviewed anything. Approving is where the
   * foods are actually decided, so that is where the recipe is built now.
   */
  it("leaves the recipe to the approval that knows which foods were chosen", async () => {
    const job = queueJob();
    job.metadata = { addToMeal: true, createRecipe: true } as never;
    vi.mocked(resolveComponent).mockResolvedValue({ candidates: [], selectedFoodId: "food-1", grams: 60, gramsSource: "PORTION" });
    vi.mocked(autoApproveProposal).mockResolvedValue({ logged: ["Brot"], skipped: [], acceptedAt: "now" });

    await processNextAiJob({ ai: workingAi() as never });

    expect(autoApproveProposal).toHaveBeenCalledWith("proposal-1");
  });

  /**
   * "Keep a recipe but do not log it" never reaches an approval, so the resolver's
   * own matches are all there is - and the recipe still has to be written.
   */

  it("leaves it pending when the user wants to approve each one", async () => {
    queueJob();
    user.findUnique.mockResolvedValueOnce({
      profile: { language: "de", researchEnabled: false, autoApproveAi: false },
    } as never);

    await processNextAiJob({ ai: workingAi() as never });
    expect(autoApproveProposal).not.toHaveBeenCalled();
  });

  /**
   * The job is already COMPLETED inside the transaction, so a throw afterwards
   * would flip it back to QUEUED through recordFailure and re-run the whole
   * parse. The parse and the resolution are worth keeping either way.
   */
  it("does not requeue a completed job when applying the proposal fails", async () => {
    queueJob();
    vi.mocked(autoApproveProposal).mockRejectedValueOnce(new Error("diary unavailable"));

    await expect(processNextAiJob({ ai: workingAi() as never })).resolves.toBe(true);
    expect(aiJobAttempt.create).not.toHaveBeenCalled();
    expect(aiJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED" }) }),
    );
  });
});

describe("what an approved proposal may log", () => {
  it("logs only components with both a resolved food and a weight", () => {
    const { loggable, skipped, skippedDetails } = decideComponents([
      { name: "egg", canonicalFoodId: "food-1", estimatedGrams: 120 },
      { name: "grandma's secret sauce", canonicalFoodId: null, estimatedGrams: 30 },
      { name: "rye bread", canonicalFoodId: "food-2" },
      { name: "water", canonicalFoodId: "food-3", estimatedGrams: 0 },
    ]);

    expect(loggable.map((entry) => entry.component.name)).toEqual(["egg"]);
    expect(skipped).toEqual(["grandma's secret sauce", "rye bread", "water"]);
    expect(skippedDetails).toEqual([
      { name: "grandma's secret sauce", reason: "NO_FOOD" },
      { name: "rye bread", reason: "NO_WEIGHT" },
      { name: "water", reason: "NO_WEIGHT" },
    ]);
  });

  it("logs the food the reviewer chose, with that food's own weight", () => {
    const component = {
      name: "Brot",
      quantity: 2,
      unit: "Scheibe",
      estimatedGrams: 60,
      canonicalFoodId: "loaf-a",
      candidates: [
        { foodId: "loaf-a", name: "Toastbrot", brand: null, origin: "OPEN_FOOD_FACTS" as const, score: 400, isEstimated: false, url: null, grams: 60, gramsSource: "SERVING" as const },
        { foodId: "loaf-b", name: "Vollkornbrot", brand: null, origin: "OPEN_FOOD_FACTS" as const, score: 380, isEstimated: false, url: null, grams: 90, gramsSource: "SERVING" as const },
      ],
    };

    const { loggable } = decideComponents([component], () => "loaf-b");
    expect(loggable).toHaveLength(1);
    expect(loggable[0].foodId).toBe("loaf-b");
    // Switching the choice switches the weight: a thicker slice is more grams.
    expect(loggable[0].grams).toBe(90);
  });

  it("treats an explicit decline as final, never falling back to an estimate", () => {
    const component = {
      name: "Mett",
      estimatedGrams: 30,
      canonicalFoodId: null,
      estimated: true,
      nutritionPer100g: { energyKcal: 250 },
    };

    expect(decideComponents([component]).loggable).toHaveLength(1);
    expect(decideComponents([component], () => "").loggable).toHaveLength(0);
    expect(decideComponents([component], () => "").skipped).toEqual(["Mett"]);
  });

  it("accepts the model's own numbers only when it actually gave any", () => {
    const withoutNumbers = { name: "Marmelade", estimatedGrams: 20, canonicalFoodId: null, estimated: true };
    expect(decideComponents([withoutNumbers], () => "estimate").loggable).toHaveLength(0);
    expect(decideComponents([withoutNumbers], () => "estimate").skipped).toEqual(["Marmelade"]);
  });
});

