/**
 * Applying an artifact somebody else's instance produced.
 *
 * The receiving end has no way to judge the values, so the protection is
 * structural: it only ever fills gaps, it matches foods by the identity their
 * own dataset gave them, and everything it writes stays badged as read by a
 * model.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { prismaMock, food, foodNutrient, foodSource, datasetImport } = vi.hoisted(() => {
  const food = { findMany: vi.fn(async (): Promise<unknown[]> => []) };
  const foodNutrient = { createMany: vi.fn(), updateMany: vi.fn() };
  const foodSource = { createMany: vi.fn() };
  const datasetImport = { findUnique: vi.fn(async (): Promise<{ checksum: string; recordCount: number } | null> => null), upsert: vi.fn() };
  return {
    food,
    foodNutrient,
    foodSource,
    datasetImport,
    prismaMock: { food, foodNutrient, foodSource, datasetImport, $transaction: vi.fn(async (ops: unknown[]) => ops) },
  };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { importEnrichmentDataset, type EnrichmentRecord } from "./enrichment";

const directory = mkdtempSync(join(tmpdir(), "nutricore-enrichment-"));
const originalDir = process.env.FOOD_DATASET_DIR;

/** Writes an artifact and manifest exactly as the export script would. */
function writeArtifact(records: EnrichmentRecord[]) {
  const artifact = gzipSync(Buffer.from(records.map((record) => `${JSON.stringify(record)}\n`).join("")));
  writeFileSync(join(directory, "ai-enrichment.ndjson.gz"), artifact);
  const checksum = createHash("sha256").update(artifact).digest("hex");
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      datasets: {
        "ai-enrichment": { version: "AI enrichment, 2026-09-05", artifact: "ai-enrichment.ndjson.gz", records: records.length, artifactSha256: checksum },
      },
    }),
  );
  return checksum;
}

const record = (values: EnrichmentRecord["values"]): EnrichmentRecord => ({
  provider: "BLS",
  externalId: "B105000",
  name: "Gouda",
  values,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FOOD_DATASET_DIR = directory;
  datasetImport.findUnique.mockResolvedValue(null);
  datasetImport.upsert.mockResolvedValue({});
  prismaMock.$transaction.mockResolvedValue([]);
});

afterEach(() => {
  if (originalDir === undefined) delete process.env.FOOD_DATASET_DIR;
  else process.env.FOOD_DATASET_DIR = originalDir;
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("importing a shipped enrichment artifact", () => {
  it("does nothing when this build ships none", async () => {
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ datasets: {} }));
    expect(await importEnrichmentDataset()).toBeNull();
  });

  it("fills a nutrient the food does not state, marked as the model's", async () => {
    writeArtifact([record([{ key: "iodine", value: 12, sourceUrl: "https://label.test", model: "qwen3.5:4b" }])]);
    food.findMany.mockResolvedValue([{ id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [] }]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.filled).toBe(1);
    expect(foodNutrient.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ foodId: "f1", nutrientKey: "iodine", value: 12, origin: "AI_ENRICHMENT" }],
      }),
    );
    // Badged as an estimate, so the far end shows it exactly as its own runs are.
    expect(foodSource.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ provider: "AI_ENRICHMENT", estimated: true })] }),
    );
  });

  it("leaves a nutrient the food already states completely alone", async () => {
    writeArtifact([record([{ key: "iodine", value: 12 }])]);
    // A measured number beats one another instance's model read.
    food.findMany.mockResolvedValue([
      { id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [{ nutrientKey: "iodine", value: 9 }] },
    ]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.filled).toBe(0);
    expect(outcome?.stats.alreadyPresent).toBe(1);
    expect(foodNutrient.createMany).not.toHaveBeenCalled();
    expect(foodNutrient.updateMany).not.toHaveBeenCalled();
  });

  it("fills a row that exists but is explicitly unknown, only while it is empty", async () => {
    writeArtifact([record([{ key: "iodine", value: 12 }])]);
    food.findMany.mockResolvedValue([
      { id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [{ nutrientKey: "iodine", value: null }] },
    ]);

    await importEnrichmentDataset();

    expect(foodNutrient.updateMany).toHaveBeenCalledWith({
      where: { foodId: "f1", nutrientKey: "iodine", value: null },
      data: { value: 12, origin: "AI_ENRICHMENT" },
    });
  });

  it("counts a food this instance does not have rather than inventing one", async () => {
    writeArtifact([record([{ key: "iodine", value: 12 }])]);
    food.findMany.mockResolvedValue([]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.unknownFoods).toBe(1);
    expect(foodNutrient.createMany).not.toHaveBeenCalled();
  });

  it("refuses a value that is not a usable number", async () => {
    writeArtifact([record([{ key: "iodine", value: -5 }, { key: "calcium", value: 700 }])]);
    food.findMany.mockResolvedValue([{ id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [] }]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.filled).toBe(1);
    expect(outcome?.stats.issues[0]).toContain("iodine");
  });

  it("costs one query when the checksum has not changed", async () => {
    const checksum = writeArtifact([record([{ key: "iodine", value: 12 }])]);
    datasetImport.findUnique.mockResolvedValue({ checksum, recordCount: 1 });

    const outcome = await importEnrichmentDataset();

    expect(outcome?.changed).toBe(false);
    expect(food.findMany).not.toHaveBeenCalled();
  });
});
