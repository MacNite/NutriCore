/**
 * Writing a bundled food database into NutriCore's own tables.
 *
 * The importer is deliberately boring and deliberately idempotent. It is run
 * by `npm run db:import:foods`, by an administrator from the admin page, and
 * potentially by a deployment script, so running it a second time has to be
 * both safe and cheap:
 *
 *  - Cheap, because the manifest checksum is compared first. An unchanged
 *    dataset costs one query, which is what keeps it out of the way of
 *    ordinary startup.
 *  - Safe, because a food is found again by its provider identity
 *    (`externalProvider` + `externalId` - a BLS code, an FDC id) and updated
 *    in place. The row keeps its id, so every diary entry, favourite and
 *    recipe ingredient pointing at it stays valid.
 *
 * A food that has disappeared from a newer dataset release is left alone and
 * counted as `stale` rather than deleted: somebody may have eaten it, and a
 * reference database dropping a record is not a reason to rewrite their diary.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/units";
import { AI_ENRICHMENT_ORIGIN } from "@/lib/nutrients";
import { logger } from "@/lib/logger";
import { readDatasetChunks, readJsonSidecar, readManifest, type DatasetManifestEntry } from "./artifacts";
import { BLS_DATASET, assertBlsComponentUnits, mapBlsRecords, type BlsComponent, type BlsRecord } from "./bls";
import { USDA_DATASETS, assertUsdaNutrientMap, mapUsdaRecords, type UsdaFoodRecord } from "./usda";
import type { DatasetDefinition, DatasetMapResult, ImportableFood } from "./types";

export interface ImportStats {
  created: number;
  updated: number;
  /** Records the reader would not map, with a sample of the reasons. */
  skipped: number;
  /** Foods already stored for this provider that the new release no longer has. */
  stale: number;
  /** Source fields no canonical nutrient key claims, most frequent first. */
  unmapped: [string, number][];
  issues: string[];
}

export interface ImportOutcome {
  key: string;
  version: string;
  /** False when the dataset was already imported at this exact checksum. */
  changed: boolean;
  records: number;
  durationMs: number;
  stats: ImportStats;
  /** The external ids this run wrote. Used to count what a release dropped. */
  seenExternalIds?: Set<string>;
}

/** Every bundled dataset, in the order a full import applies them. */
export const DATASET_DEFINITIONS: Record<string, DatasetDefinition> = {
  bls: BLS_DATASET,
  ...USDA_DATASETS,
};

export const DATASET_KEYS = Object.keys(DATASET_DEFINITIONS);

interface Reader {
  definition: DatasetDefinition;
  /** Validates the artifact before a single row is written. */
  verify: (entry: DatasetManifestEntry) => void;
  chunks: (entry: DatasetManifestEntry) => AsyncGenerator<unknown[]>;
  map: (chunk: unknown[]) => DatasetMapResult;
}

function readerFor(key: string): Reader {
  const definition = DATASET_DEFINITIONS[key];
  if (!definition) throw new Error(`Unknown food dataset "${key}"`);

  if (key === "bls") {
    return {
      definition,
      verify: (entry) => {
        if (!entry.components) throw new Error("The BLS manifest entry names no component reference file");
        const sidecar = readJsonSidecar<{ components: BlsComponent[] }>(entry.components);
        // A unit change in a new BLS release must stop the import, not silently
        // rescale 7,140 foods.
        assertBlsComponentUnits(sidecar.components ?? []);
      },
      chunks: (entry) => readDatasetChunks<BlsRecord>(entry.artifact),
      map: (chunk) => mapBlsRecords(chunk as BlsRecord[]),
    };
  }

  return {
    definition,
    verify: () => assertUsdaNutrientMap(),
    chunks: (entry) => readDatasetChunks<UsdaFoodRecord>(entry.artifact),
    map: (chunk) => mapUsdaRecords(chunk as UsdaFoodRecord[]),
  };
}

const MAX_REPORTED_ISSUES = 20;
const MAX_REPORTED_UNMAPPED = 40;

/** The Food columns a dataset owns, and therefore rewrites on every import. */
function foodData(food: ImportableFood, definition: DatasetDefinition) {
  const defaultServing = food.servings.find((serving) => serving.isDefault) ?? food.servings[0];
  return {
    name: food.name,
    normalizedName: normalizeName(food.name),
    locale: food.locale,
    foodType: food.foodType,
    sourceType: definition.sourceType,
    externalProvider: definition.provider,
    externalId: food.externalId,
    basisAmount: food.basisAmount,
    basisUnit: food.basisUnit,
    servingSize: defaultServing?.gramEquivalent ?? null,
    servingUnit: defaultServing?.gramEquivalent ? "g" : null,
    rawState: food.rawState,
    dataConfidence: definition.confidence,
    isEstimated: false,
    // A bundled database is shared and permanent: no owner, no expiry.
    ownerId: null,
    cacheExpiresAt: null,
  };
}

interface ChunkWriteResult {
  created: number;
  updated: number;
}

async function writeChunk(foods: ImportableFood[], definition: DatasetDefinition, retrievedAt: Date): Promise<ChunkWriteResult> {
  if (foods.length === 0) return { created: 0, updated: 0 };

  const externalIds = foods.map((food) => food.externalId);
  const existing = await prisma.food.findMany({
    where: { externalProvider: definition.provider, externalId: { in: externalIds } },
    select: { id: true, externalId: true },
  });
  const idByExternalId = new Map(existing.map((row) => [row.externalId ?? "", row.id]));

  const creates: Prisma.FoodCreateManyInput[] = [];
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  const nutrientRows: Prisma.FoodNutrientCreateManyInput[] = [];
  const translationRows: Prisma.FoodTranslationCreateManyInput[] = [];
  const aliasRows: Prisma.FoodAliasCreateManyInput[] = [];
  const servingRows: Prisma.FoodServingCreateManyInput[] = [];
  const sourceRows: Prisma.FoodSourceCreateManyInput[] = [];
  const touchedIds: string[] = [];

  for (const food of foods) {
    const data = foodData(food, definition);
    const existingId = idByExternalId.get(food.externalId);
    if (existingId) {
      updates.push(prisma.food.update({ where: { id: existingId }, data }));
    } else {
      // An explicit id lets the whole chunk be written with createMany, which
      // is what turns 15,296 round trips into a few dozen statements.
      creates.push({ id: randomUUID(), ...data });
    }
  }

  // Create first, then read back every id for this chunk. Doing it in that
  // order rather than trusting the ids generated above is what makes the
  // import safe to run twice at once: if another process created the same food
  // between the lookup and the insert, `skipDuplicates` drops our row and this
  // query finds theirs, so the nutrient rows below can never reference an id
  // that was never inserted.
  if (creates.length > 0) await prisma.food.createMany({ data: creates, skipDuplicates: true });
  const stored = await prisma.food.findMany({
    where: { externalProvider: definition.provider, externalId: { in: externalIds } },
    select: { id: true, externalId: true },
  });
  const resolvedId = new Map(stored.map((row) => [row.externalId ?? "", row.id]));

  for (const food of foods) {
    const id = resolvedId.get(food.externalId);
    if (!id) continue;
    touchedIds.push(id);

    for (const [nutrientKey, nutrient] of Object.entries(food.nutrients)) {
      nutrientRows.push({
        foodId: id,
        nutrientKey,
        value: nutrient.value,
        sourceValue: nutrient.sourceValue,
        sourceUnit: nutrient.sourceUnit,
        qualifier: nutrient.qualifier,
        origin: nutrient.origin,
      });
    }
    for (const translation of food.translations) {
      translationRows.push({
        foodId: id,
        locale: translation.locale,
        name: translation.name,
        normalizedName: normalizeName(translation.name),
      });
    }
    for (const alias of food.aliases) {
      aliasRows.push({ foodId: id, name: alias.name, locale: alias.locale });
    }
    for (const serving of food.servings) {
      servingRows.push({
        foodId: id,
        label: serving.label,
        amount: serving.amount,
        unit: serving.unit,
        gramEquivalent: serving.gramEquivalent,
        mlEquivalent: serving.mlEquivalent,
        isDefault: serving.isDefault,
      });
    }
    sourceRows.push({
      foodId: id,
      provider: definition.provider,
      providerId: food.externalId,
      retrievedAt,
      url: definition.url(food.externalId),
      confidence: definition.confidence,
      estimated: false,
      metadata: food.metadata as Prisma.InputJsonValue,
    });
  }

  // Which AI-backfilled values this import is about to destroy, and which of
  // them it has no replacement for.
  //
  // The delete below is deliberately total - a value the source has withdrawn
  // must not survive as a stale number - but it used to take the enrichment with
  // it, silently, on every dataset upgrade: nutrients are not scoped by provider
  // the way `FoodSource` is, so a month of backfill vanished and left only the
  // audit row behind, still advertising values that were gone. So the AI rows
  // are read first and the ones the dataset does not itself supply are written
  // back afterwards. A real measured number always wins; the model only ever
  // keeps the gaps the database still does not fill.
  const supplied = new Set(nutrientRows.map((row) => `${row.foodId}\u0000${row.nutrientKey}`));
  const survivingAiRows = (
    await prisma.foodNutrient.findMany({
      where: { foodId: { in: touchedIds }, origin: AI_ENRICHMENT_ORIGIN },
      select: { foodId: true, nutrientKey: true, value: true, sourceValue: true, sourceUnit: true, qualifier: true, origin: true },
    })
  ).filter((row) => !supplied.has(`${row.foodId}\u0000${row.nutrientKey}`));

  // One transaction per chunk: a food and its nutrients are never half-written,
  // and an interrupted import can simply be run again.
  await prisma.$transaction([
    ...updates,
    // The dataset owns these rows, so they are replaced rather than merged: a
    // value the source has withdrawn must not survive as a stale number.
    prisma.foodNutrient.deleteMany({ where: { foodId: { in: touchedIds } } }),
    prisma.foodTranslation.deleteMany({ where: { foodId: { in: touchedIds } } }),
    prisma.foodAlias.deleteMany({ where: { foodId: { in: touchedIds } } }),
    prisma.foodServing.deleteMany({ where: { foodId: { in: touchedIds } } }),
    prisma.foodSource.deleteMany({ where: { foodId: { in: touchedIds }, provider: definition.provider } }),
    ...(nutrientRows.length > 0 ? [prisma.foodNutrient.createMany({ data: nutrientRows, skipDuplicates: true })] : []),
    ...(survivingAiRows.length > 0
      ? [prisma.foodNutrient.createMany({ data: survivingAiRows, skipDuplicates: true })]
      : []),
    ...(translationRows.length > 0
      ? [prisma.foodTranslation.createMany({ data: translationRows, skipDuplicates: true })]
      : []),
    ...(aliasRows.length > 0 ? [prisma.foodAlias.createMany({ data: aliasRows })] : []),
    ...(servingRows.length > 0 ? [prisma.foodServing.createMany({ data: servingRows })] : []),
    prisma.foodSource.createMany({ data: sourceRows }),
  ]);

  return { created: creates.length, updated: updates.length };
}

export interface ImportOptions {
  /** Re-import even when the checksum says nothing changed. */
  force?: boolean;
  onProgress?: (imported: number, total: number) => void;
}

/** Imports one bundled dataset. */
export async function importDataset(key: string, options: ImportOptions = {}): Promise<ImportOutcome> {
  const started = Date.now();
  const reader = readerFor(key);
  const manifest = readManifest();
  const entry = manifest?.datasets[key];
  if (!entry) {
    throw new Error(`The bundled dataset manifest has no entry for "${key}". Run \`npm run datasets:convert\`.`);
  }

  const previous = await prisma.datasetImport.findUnique({ where: { key } });
  if (!options.force && previous?.checksum === entry.artifactSha256) {
    return {
      key,
      version: entry.version,
      changed: false,
      records: previous.recordCount,
      durationMs: Date.now() - started,
      stats: { created: 0, updated: 0, skipped: 0, stale: 0, unmapped: [], issues: [] },
    };
  }

  reader.verify(entry);

  const retrievedAt = new Date();
  const stats: ImportStats = { created: 0, updated: 0, skipped: 0, stale: 0, unmapped: [], issues: [] };
  const unmapped: Record<string, number> = {};
  const seen = new Set<string>();
  let imported = 0;

  for await (const chunk of reader.chunks(entry)) {
    const mapped = reader.map(chunk);
    stats.skipped += mapped.issues.length;
    for (const issue of mapped.issues) {
      if (stats.issues.length < MAX_REPORTED_ISSUES) stats.issues.push(`${issue.externalId}: ${issue.detail}`);
    }
    for (const [field, count] of Object.entries(mapped.unmapped)) {
      unmapped[field] = (unmapped[field] ?? 0) + count;
    }

    const written = await writeChunk(mapped.foods, reader.definition, retrievedAt);
    stats.created += written.created;
    stats.updated += written.updated;
    for (const food of mapped.foods) seen.add(food.externalId);
    imported += mapped.foods.length;
    options.onProgress?.(imported, entry.records);
  }

  stats.unmapped = Object.entries(unmapped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_REPORTED_UNMAPPED);

  const durationMs = Date.now() - started;
  const statsJson = stats as unknown as Prisma.InputJsonValue;
  await prisma.datasetImport.upsert({
    where: { key },
    create: {
      key,
      version: entry.version,
      checksum: entry.artifactSha256,
      recordCount: seen.size,
      stats: statsJson,
      durationMs,
    },
    update: {
      version: entry.version,
      checksum: entry.artifactSha256,
      recordCount: seen.size,
      stats: statsJson,
      durationMs,
    },
  });

  logger.info("Imported bundled food dataset", {
    key,
    version: entry.version,
    created: stats.created,
    updated: stats.updated,
    skipped: stats.skipped,
    durationMs,
  });

  return { key, version: entry.version, changed: true, records: seen.size, durationMs, stats, seenExternalIds: seen };
}

/**
 * Counts, per provider, the foods still stored that the imported releases no
 * longer list.
 *
 * This cannot be done inside `importDataset`, because Foundation Foods and SR
 * Legacy are two datasets behind one provider identity: asking after the SR
 * Legacy pass how many `USDA_FDC` foods went unseen counts all 363 Foundation
 * foods as stale. So it is answered once, and only for a provider whose every
 * dataset actually ran - otherwise the number would be an artefact of which
 * datasets were selected rather than of the data.
 */
async function countStale(outcomes: ImportOutcome[]): Promise<void> {
  const byProvider = new Map<string, ImportOutcome[]>();
  for (const outcome of outcomes) {
    const provider = DATASET_DEFINITIONS[outcome.key]?.provider;
    if (!provider) continue;
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), outcome]);
  }

  for (const [provider, group] of byProvider) {
    const expected = DATASET_KEYS.filter((key) => DATASET_DEFINITIONS[key].provider === provider);
    if (group.length !== expected.length || group.some((outcome) => !outcome.changed)) continue;

    const seen = new Set(group.flatMap((outcome) => [...(outcome.seenExternalIds ?? [])]));
    const stored = await prisma.food.findMany({
      where: { externalProvider: provider },
      select: { externalId: true },
    });
    const stale = stored.filter((row) => !row.externalId || !seen.has(row.externalId)).length;
    // Reported against the newest dataset of the provider, which is the one an
    // administrator is looking at when they wonder about the number.
    const target = group[group.length - 1];
    target.stats.stale = stale;
  }
}

/**
 * Imports every dataset the manifest lists, one after another. A failure is
 * reported per dataset rather than aborting the rest: BLS being importable
 * should not depend on USDA being importable.
 */
export async function importAllDatasets(
  options: ImportOptions & { keys?: string[] } = {},
): Promise<{ outcomes: ImportOutcome[]; failures: { key: string; error: string }[] }> {
  const manifest = readManifest();
  const keys = (options.keys ?? DATASET_KEYS).filter((key) => manifest?.datasets[key]);
  const outcomes: ImportOutcome[] = [];
  const failures: { key: string; error: string }[] = [];

  for (const key of keys) {
    try {
      outcomes.push(await importDataset(key, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ key, error: message });
      logger.error("Food dataset import failed", { key, error: message });
    }
  }

  await countStale(outcomes);
  // The stale count is learnt after the row was written, so persist it.
  for (const outcome of outcomes) {
    if (!outcome.changed || outcome.stats.stale === 0) continue;
    await prisma.datasetImport.update({
      where: { key: outcome.key },
      data: { stats: outcome.stats as unknown as Prisma.InputJsonValue },
    });
  }

  return { outcomes, failures };
}

/** What the admin page shows: what is bundled, and what has been imported. */
export async function datasetStatus() {
  const manifest = readManifest();
  const imports = await prisma.datasetImport.findMany();
  const byKey = new Map(imports.map((row) => [row.key, row]));

  return DATASET_KEYS.filter((key) => manifest?.datasets[key]).map((key) => {
    const entry = manifest!.datasets[key];
    const imported = byKey.get(key);
    return {
      key,
      version: entry.version,
      bundledRecords: entry.records,
      importedRecords: imported?.recordCount ?? 0,
      importedAt: imported?.updatedAt ?? null,
      upToDate: imported?.checksum === entry.artifactSha256,
    };
  });
}
