/**
 * The importer itself: idempotency, identity, and refusing to write data it
 * cannot vouch for.
 *
 * It runs against a temporary artifact directory built from the real fixture
 * records, so the whole path - manifest, checksum, gzipped NDJSON, mapping,
 * chunked write - is exercised without a database and without touching the
 * bundled datasets.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    datasetImport: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    food: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    foodNutrient: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodTranslation: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodAlias: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodServing: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodSource: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { BLS_COMPONENT_MAP, type BlsComponent, type BlsRecord } from "./bls";
import { importDataset } from "./import";

const records = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "bls-records.json"), "utf8"),
) as BlsRecord[];
const components = (
  JSON.parse(readFileSync(join(process.cwd(), "datasets", "bundled", "bls-4.0-components.json"), "utf8")) as {
    components: BlsComponent[];
  }
).components;

const directory = mkdtempSync(join(tmpdir(), "nutricore-datasets-"));
const originalDir = process.env.FOOD_DATASET_DIR;

/** Writes a manifest and artifact pair, exactly as the converter would. */
function writeArtifacts(foods: BlsRecord[], componentList: BlsComponent[] = components) {
  const artifact = gzipSync(Buffer.from(foods.map((food) => `${JSON.stringify(food)}\n`).join("")));
  writeFileSync(join(directory, "bls-test.ndjson.gz"), artifact);
  writeFileSync(
    join(directory, "bls-test-components.json"),
    JSON.stringify({ version: "test", components: componentList }),
  );
  const checksum = createHash("sha256").update(artifact).digest("hex");
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      datasets: {
        bls: {
          version: "4.0 (test)",
          artifact: "bls-test.ndjson.gz",
          components: "bls-test-components.json",
          records: foods.length,
          artifactSha256: checksum,
        },
      },
    }),
  );
  return checksum;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FOOD_DATASET_DIR = directory;
  prismaMock.datasetImport.findUnique.mockResolvedValue(null);
  prismaMock.datasetImport.upsert.mockResolvedValue({});
  prismaMock.datasetImport.findMany.mockResolvedValue([]);
  prismaMock.food.findMany.mockResolvedValue([]);
  prismaMock.food.createMany.mockResolvedValue({ count: 0 });
  prismaMock.$transaction.mockResolvedValue([]);
});

afterEach(() => {
  if (originalDir === undefined) delete process.env.FOOD_DATASET_DIR;
  else process.env.FOOD_DATASET_DIR = originalDir;
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("importing a dataset", () => {
  it("creates a food per record, with its nutrients, names and provenance", async () => {
    writeArtifacts(records);
    // Nothing stored yet, then the created rows are read back.
    prismaMock.food.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(records.map((record, index) => ({ id: `food-${index}`, externalId: record.code })));

    const outcome = await importDataset("bls");

    expect(outcome.changed).toBe(true);
    expect(outcome.stats.created).toBe(records.length);
    expect(outcome.stats.updated).toBe(0);
    expect(outcome.stats.skipped).toBe(0);

    const created = prismaMock.food.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(records.length);
    expect(created[0]).toMatchObject({
      externalProvider: "BLS",
      externalId: records[0].code,
      sourceType: "BLS",
      ownerId: null,
      basisAmount: 100,
      basisUnit: "G",
      // A bundled database is permanent: it never carries an expiry.
      cacheExpiresAt: null,
    });
    expect(prismaMock.foodNutrient.createMany).toHaveBeenCalled();
    expect(prismaMock.foodTranslation.createMany).toHaveBeenCalled();
    expect(prismaMock.foodSource.createMany).toHaveBeenCalled();
  });

  it("records the version and checksum it imported", async () => {
    const checksum = writeArtifacts(records);
    prismaMock.food.findMany.mockResolvedValue([]);

    await importDataset("bls");

    expect(prismaMock.datasetImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "bls" },
        create: expect.objectContaining({ key: "bls", version: "4.0 (test)", checksum }),
      }),
    );
  });

  it("does nothing at all when the checksum has not changed", async () => {
    const checksum = writeArtifacts(records);
    prismaMock.datasetImport.findUnique.mockResolvedValue({ checksum, recordCount: records.length });

    const outcome = await importDataset("bls");

    expect(outcome.changed).toBe(false);
    // Not one row read or written: this is what makes it safe on deployment.
    expect(prismaMock.food.findMany).not.toHaveBeenCalled();
    expect(prismaMock.food.createMany).not.toHaveBeenCalled();
    expect(prismaMock.datasetImport.upsert).not.toHaveBeenCalled();
  });

  it("re-imports the same checksum when told to", async () => {
    const checksum = writeArtifacts(records);
    prismaMock.datasetImport.findUnique.mockResolvedValue({ checksum, recordCount: records.length });

    const outcome = await importDataset("bls", { force: true });

    expect(outcome.changed).toBe(true);
    expect(prismaMock.food.createMany).toHaveBeenCalled();
  });

  it("updates a food in place rather than creating a second one", async () => {
    writeArtifacts(records);
    // Everything is already stored, under ids a diary entry may point at.
    const stored = records.map((record, index) => ({ id: `existing-${index}`, externalId: record.code }));
    prismaMock.food.findMany.mockResolvedValue(stored);

    const outcome = await importDataset("bls");

    expect(outcome.stats.created).toBe(0);
    expect(outcome.stats.updated).toBe(records.length);
    // No new rows, and each update keeps the row's own id - which is what
    // keeps every diary entry, favourite and recipe ingredient valid.
    expect(prismaMock.food.createMany).not.toHaveBeenCalled();
    const updatedIds = prismaMock.food.update.mock.calls.map((call) => call[0].where.id);
    expect(updatedIds.sort()).toEqual(stored.map((row) => row.id).sort());
  });

  it("finds a food again by the source's own identifier", async () => {
    writeArtifacts(records);
    prismaMock.food.findMany.mockResolvedValue([]);

    await importDataset("bls");

    expect(prismaMock.food.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalProvider: "BLS", externalId: { in: records.map((record) => record.code) } },
      }),
    );
  });

  it("writes the children with the ids the database actually holds", async () => {
    writeArtifacts(records);
    // A concurrent import created one of them first, under a different id.
    prismaMock.food.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(records.map((record, index) => ({ id: `theirs-${index}`, externalId: record.code })));

    await importDataset("bls");

    const nutrientRows = prismaMock.foodNutrient.createMany.mock.calls[0][0].data;
    const ids = new Set(nutrientRows.map((row: { foodId: string }) => row.foodId));
    for (const id of ids) expect(String(id)).toMatch(/^theirs-/);
  });
});

describe("refusing to import data it cannot vouch for", () => {
  it("stops when a component's unit has changed", async () => {
    // The whole point of shipping the component reference: a release that
    // switches copper from µg to mg must fail rather than rescale 7,140 foods.
    writeArtifacts(
      records,
      components.map((component) => (component.code === "CU" ? { ...component, unit: "mg" } : component)),
    );

    await expect(importDataset("bls")).rejects.toThrow(/CU is published in "mg"/);
    expect(prismaMock.food.createMany).not.toHaveBeenCalled();
  });

  it("stops when the manifest has no entry for the dataset", async () => {
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ datasets: {} }));
    await expect(importDataset("bls")).rejects.toThrow(/no entry for "bls"/);
  });

  it("rejects a dataset it does not know", async () => {
    writeArtifacts(records);
    await expect(importDataset("not-a-dataset")).rejects.toThrow(/Unknown food dataset/);
  });

  it("reports a record it could not map instead of dropping it silently", async () => {
    writeArtifacts([...records, { code: "", nameDe: "", nameEn: "", note: null, values: {} }]);
    prismaMock.food.findMany.mockResolvedValue([]);

    const outcome = await importDataset("bls");

    expect(outcome.stats.skipped).toBe(1);
    expect(outcome.stats.issues[0]).toContain("no BLS code");
  });

  it("reports the source fields no nutrient key claims", async () => {
    writeArtifacts(records);
    prismaMock.food.findMany.mockResolvedValue([]);

    const outcome = await importDataset("bls");

    // Amino acids and the fatty-acid spectrum are out of the catalogue by
    // decision, and being counted is what keeps that visible rather than
    // accidental. The list is a capped sample, so the assertion is about what
    // it may and may not contain rather than about one particular component.
    expect(outcome.stats.unmapped.length).toBeGreaterThan(0);
    expect(outcome.stats.unmapped.length).toBeLessThanOrEqual(40);
    const reported = Object.fromEntries(outcome.stats.unmapped);
    for (const code of Object.keys(BLS_COMPONENT_MAP)) {
      expect(reported[code], `${code} is mapped and must not be reported as unmapped`).toBeUndefined();
    }
    for (const [, count] of outcome.stats.unmapped) expect(count).toBe(records.length);
  });
});
