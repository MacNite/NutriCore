import { beforeEach, describe, expect, it, vi } from "vitest";
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { aiJob: { findMany } } }));
import { hasRunInFlight, mealPlaceholders, placeholderReason, recipePlaceholders } from "./ai-placeholders";
beforeEach(() => findMany.mockReset());
describe("intent placeholders", () => {
  it("queries meal placeholders by stored intent", async () => { findMany.mockResolvedValue([]); await mealPlaceholders("u", "2026-09-03"); expect(findMany.mock.calls[0][0].where).toMatchObject({ entityType: "AI_INGESTION", ingestionInput: { intent: "MEAL" } }); });
  it("shows recipe runs only in recipes", async () => { findMany.mockResolvedValue([{ id: "j", status: "RUNNING", entityId: "i", ingestionInput: { intent: "RECIPE", text: "Soup", sourceUrl: null } }]); await expect(recipePlaceholders("u")).resolves.toEqual([{ id: "j", status: "RUNNING", href: "/recipes/new?import=i", source: "Soup" }]); });
});

/**
 * A run that ends FAILED - which is where every job goes when Ollama cannot be
 * reached - used to drop out of these lists entirely, so the submitted work
 * looked silently discarded. It stays, says why, and offers a re-run.
 */
describe("failed placeholders", () => {
  const failedJob = (overrides: Record<string, unknown> = {}) => ({
    id: "j",
    status: "FAILED",
    entityId: "i",
    metadata: null,
    failureKind: "MODEL_UNREACHABLE",
    ingestionInput: { intent: "RECIPE", text: "Soup", sourceUrl: null, imageMime: null },
    ...overrides,
  });

  it("asks for failures alongside the runs still in flight", async () => {
    findMany.mockResolvedValue([]);
    await recipePlaceholders("u");
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { status: { in: ["QUEUED", "RUNNING"] } },
      { status: "FAILED", failedAt: { gt: expect.any(Date) } },
    ]);
  });

  it("keeps a failed run listed, with its reason and a re-run", async () => {
    findMany.mockResolvedValue([failedJob()]);
    await expect(recipePlaceholders("u")).resolves.toEqual([
      { id: "j", status: "FAILED", href: "/recipes/new?import=i", source: "Soup", reason: "MODEL_UNREACHABLE", retryable: true },
    ]);
  });

  it("offers no re-run once the only input left was the deleted photo", async () => {
    findMany.mockResolvedValue([failedJob({ ingestionInput: { intent: "RECIPE", text: "", sourceUrl: null, imageMime: null } })]);
    await expect(recipePlaceholders("u")).resolves.toMatchObject([{ retryable: false }]);
  });

  it("re-runs a meal whose extraction is cached even without its photo", async () => {
    findMany.mockResolvedValue([failedJob({ metadata: { extraction: { components: [] } }, ingestionInput: { intent: "MEAL", text: "", sourceUrl: null, imageMime: null, meal: "LUNCH" } })]);
    await expect(mealPlaceholders("u", "2026-09-03")).resolves.toMatchObject([{ status: "FAILED", retryable: true, meal: "LUNCH" }]);
  });

  it("carries no failure fields while a run is still going", async () => {
    findMany.mockResolvedValue([failedJob({ status: "QUEUED" })]);
    const [placeholder] = await recipePlaceholders("u");
    expect(placeholder).not.toHaveProperty("reason");
    expect(placeholder).not.toHaveProperty("retryable");
  });

  it("reads every failure kind as something the submitter can act on", () => {
    expect(placeholderReason("MODEL_HTTP_ERROR")).toBe("MODEL_UNREACHABLE");
    expect(placeholderReason("MODEL_TIMEOUT")).toBe("MODEL_TIMEOUT");
    expect(placeholderReason("SOURCE_BLOCKED")).toBe("SOURCE_UNAVAILABLE");
    expect(placeholderReason("UNKNOWN")).toBe("OTHER");
    expect(placeholderReason(null)).toBe("OTHER");
  });

  it("polls only while something can still finish on its own", () => {
    expect(hasRunInFlight([{ id: "j", status: "FAILED", href: "/", source: "" }])).toBe(false);
    expect(hasRunInFlight([{ id: "j", status: "FAILED", href: "/", source: "" }, { id: "k", status: "QUEUED", href: "/", source: "" }])).toBe(true);
  });
});
