/**
 * What may leave one instance, and what happens to it at the other end.
 *
 * The export is the only part of this feature whose output reaches people who
 * did not run it, so what it refuses to include is asserted as carefully as
 * what it includes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, food } = vi.hoisted(() => {
  // The export only reads foods; everything it needs comes back on that query.
  const food = { findMany: vi.fn(async (): Promise<unknown[]> => []) };
  return { food, prismaMock: { food } };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { collectEnrichmentExport, enrichmentNdjson } from "./enrichment-export";

const run = (keys: string[], overrides: Partial<{ sourceUrl: string; model: string; retrievedAt: Date }> = {}) => ({
  sourceUrl: overrides.sourceUrl ?? "https://label.test",
  model: overrides.model ?? "qwen3.5:4b",
  retrievedAt: overrides.retrievedAt ?? new Date("2026-03-01T00:00:00Z"),
  values: keys.map((nutrientKey) => ({ nutrientKey })),
});

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` clears calls but leaves queued one-shot values in place, and
  // a page shorter than the batch ends the loop - so an unconsumed `Once` from
  // one test would be handed to the next one's first query.
  food.findMany.mockReset();
});

describe("what the export collects", () => {
  it("asks only for catalogue foods that carry an AI value", async () => {
    food.findMany.mockResolvedValue([]);
    await collectEnrichmentExport();

    // The identity filter is the privacy guarantee: a food somebody created has
    // no external id, so it cannot reach the artifact at all.
    expect(food.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          externalProvider: { not: null },
          externalId: { not: null },
          ownerId: null,
        }),
      }),
    );
  });

  it("carries the page and model each value came from", async () => {
    food.findMany.mockResolvedValueOnce([
      {
        id: "f1", name: "Gouda", externalProvider: "BLS", externalId: "B105000",
        nutrients: [{ nutrientKey: "iodine", value: 12 }],
        enrichmentProposals: [run(["iodine"])],
      },
    ]);

    const [exported] = await collectEnrichmentExport();

    expect(exported).toEqual({
      provider: "BLS",
      externalId: "B105000",
      name: "Gouda",
      values: [{ key: "iodine", value: 12, sourceUrl: "https://label.test", model: "qwen3.5:4b", retrievedAt: "2026-03-01T00:00:00.000Z" }],
    });
  });

  it("drops a value nothing can account for rather than shipping it unattributed", async () => {
    food.findMany.mockResolvedValueOnce([
      {
        id: "f1", name: "Gouda", externalProvider: "BLS", externalId: "B105000",
        // `calcium` is live and marked AI, but no approved proposal explains it.
        nutrients: [{ nutrientKey: "iodine", value: 12 }, { nutrientKey: "calcium", value: 700 }],
        enrichmentProposals: [run(["iodine"])],
      },
    ]);

    const [exported] = await collectEnrichmentExport();

    expect(exported.values.map((value) => value.key)).toEqual(["iodine"]);
  });

  it("prefers the most recent run when a value has been approved more than once", async () => {
    food.findMany.mockResolvedValueOnce([
      {
        id: "f1", name: "Gouda", externalProvider: "BLS", externalId: "B105000",
        nutrients: [{ nutrientKey: "iodine", value: 12 }],
        enrichmentProposals: [
          run(["iodine"], { sourceUrl: "https://old.test", retrievedAt: new Date("2026-01-01T00:00:00Z") }),
          run(["iodine"], { sourceUrl: "https://new.test", retrievedAt: new Date("2026-06-01T00:00:00Z") }),
        ],
      },
    ]);

    const [exported] = await collectEnrichmentExport();

    expect(exported.values[0].sourceUrl).toBe("https://new.test");
  });

  it("omits a food whose every value was unattributable", async () => {
    food.findMany.mockResolvedValueOnce([
      { id: "f1", name: "Gouda", externalProvider: "BLS", externalId: "B105000", nutrients: [{ nutrientKey: "iodine", value: 12 }], enrichmentProposals: [] },
    ]);

    expect(await collectEnrichmentExport()).toEqual([]);
  });

  it("serialises one sorted record per line, so an unchanged catalogue diffs to nothing", () => {
    const ndjson = enrichmentNdjson([
      { provider: "BLS", externalId: "B1", name: "A", values: [{ key: "iodine", value: 1, sourceUrl: null, model: null, retrievedAt: "2026-01-01T00:00:00.000Z" }] },
      { provider: "USDA_FDC", externalId: "1", name: "B", values: [] },
    ]);
    expect(ndjson.split("\n").filter(Boolean)).toHaveLength(2);
    expect(JSON.parse(ndjson.split("\n")[0]).externalId).toBe("B1");
  });
});
