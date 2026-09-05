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

const { prismaMock, food, foodNutrient, foodSource, datasetImport, nutrientDefinition } = vi.hoisted(() => {
  const food = { findMany: vi.fn(async (): Promise<unknown[]> => []) };
  const nutrientDefinition = { findMany: vi.fn(async () => [{ key: "iodine" }, { key: "calcium" }, { key: "iron" }]) };
  const foodNutrient = { createMany: vi.fn(), updateMany: vi.fn() };
  const foodSource = { createMany: vi.fn() };
  const datasetImport = { findUnique: vi.fn(async (): Promise<{ checksum: string; recordCount: number } | null> => null), upsert: vi.fn() };
  return {
    food,
    foodNutrient,
    foodSource,
    datasetImport,
    nutrientDefinition,
    prismaMock: { food, foodNutrient, foodSource, datasetImport, nutrientDefinition, $transaction: vi.fn(async (ops: unknown[]) => ops) },
  };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { importEnrichmentDataset, type EnrichmentRecord } from "./enrichment";

/** The artifact is read as unknown, so a test may write a malformed record. */
type RawRecord = EnrichmentRecord | Record<string, unknown>;

const directory = mkdtempSync(join(tmpdir(), "nutricore-enrichment-"));
const originalDir = process.env.FOOD_DATASET_DIR;

/** Writes an artifact and manifest exactly as the export script would. */
function writeArtifact(records: RawRecord[]) {
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
  nutrientDefinition.findMany.mockResolvedValue([{ key: "iodine" }, { key: "calcium" }, { key: "iron" }]);
  // The importer reads each operation's result to learn what was written, so
  // the mock answers as the database would: one `count` per queued statement.
  prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => ops.map(() => ({ count: 1 })));
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

  it("refuses a nutrient this catalogue does not define", async () => {
    // `FoodNutrient.nutrientKey` is a foreign key onto the catalogue, so
    // writing an unknown one raises a constraint violation that takes the whole
    // import down. It has to be caught before any statement is queued.
    writeArtifact([record([{ key: "unobtainium", value: 1 }, { key: "iodine", value: 12 }])]);
    food.findMany.mockResolvedValue([{ id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [] }]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.rejected).toBe(1);
    expect(outcome?.stats.issues[0]).toContain("unobtainium");
    expect(foodNutrient.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ nutrientKey: "iodine" })] }),
    );
  });

  it("reports a malformed record instead of throwing on it", async () => {
    // A null inside `values` used to be dereferenced and take the import with it.
    writeArtifact([
      { provider: "BLS", externalId: "B1", values: [null] },
      { provider: "BLS", externalId: "B2", values: "not an array" },
      { values: [{ key: "iodine", value: 12 }] },
      record([{ key: "iodine", value: 12 }]),
    ]);
    food.findMany.mockResolvedValue([{ id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [] }]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.rejected).toBe(3);
    // The one good record still lands.
    expect(outcome?.stats.filled).toBe(1);
  });

  it("counts a nutrient named twice once, because the database writes it once", async () => {
    writeArtifact([record([{ key: "iodine", value: 12 }, { key: "iodine", value: 13 }])]);
    food.findMany.mockResolvedValue([{ id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [] }]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.filled).toBe(1);
    expect(outcome?.stats.rejected).toBe(1);
  });

  it("counts only what the database confirms it wrote", async () => {
    writeArtifact([record([{ key: "iodine", value: 12 }])]);
    food.findMany.mockResolvedValue([
      { id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [{ nutrientKey: "iodine", value: null }] },
    ]);
    // Another writer filled the row between the read and the write, so the
    // conditional update matches nothing.
    prismaMock.$transaction.mockResolvedValue([{ count: 0 }]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.filled).toBe(0);
    // And nothing claims to have written it.
    expect(foodSource.createMany).not.toHaveBeenCalled();
  });

  it("reports the successful creates when another create loses a race", async () => {
    // A batched `createMany` returns one total, so a single racing duplicate
    // used to make every other create in the batch unattributable and the whole
    // lot went uncounted. One statement per fill keeps each answer its own.
    writeArtifact([record([{ key: "iodine", value: 12 }, { key: "calcium", value: 100 }])]);
    food.findMany.mockResolvedValue([{ id: "f1", externalProvider: "BLS", externalId: "B105000", nutrients: [] }]);
    prismaMock.$transaction.mockResolvedValue([{ count: 1 }, { count: 0 }]);

    const outcome = await importEnrichmentDataset();

    expect(outcome?.stats.filled).toBe(1);
    expect(foodSource.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ metadata: expect.objectContaining({ nutrientKeys: ["iodine"] }) })],
      skipDuplicates: true,
    });
  });

  it("costs one query when the checksum has not changed", async () => {
    const checksum = writeArtifact([record([{ key: "iodine", value: 12 }])]);
    datasetImport.findUnique.mockResolvedValue({ checksum, recordCount: 1 });

    const outcome = await importEnrichmentDataset();

    expect(outcome?.changed).toBe(false);
    expect(food.findMany).not.toHaveBeenCalled();
  });
});
