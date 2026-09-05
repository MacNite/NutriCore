/**
 * Importing a shipped enrichment artifact.
 *
 * This is deliberately not a `DatasetDefinition`. BLS and USDA describe whole
 * foods and own every column of the rows they write; this describes gaps in
 * foods that already exist, matched by the identity their own dataset gave
 * them. It creates nothing, replaces nothing, and touches only nutrients no
 * source has supplied.
 *
 * By the time it ships it has been through two reviews - the administrator who
 * approved each value on the instance it came from, and the repository pull
 * request that added the artifact - so it applies directly, like any other
 * bundled database. It still lands as `AI_ENRICHMENT` with an estimated source
 * row, so every value stays badged as read by a model rather than measured, and
 * a real number always wins: the write is conditional on the gap still being a
 * gap.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AI_ENRICHMENT_ORIGIN } from "@/lib/nutrients";
import { readDatasetChunks, readManifestEntry } from "./artifacts";

export const ENRICHMENT_DATASET_KEY = "ai-enrichment";
export const ENRICHMENT_PROVIDER = "AI_ENRICHMENT";

/**
 * One record of the artifact, validated before a single row is written.
 *
 * The artifact is reviewed in a pull request before it ships, so this is not
 * defence against an attacker - it is defence against a mistake, and the cost
 * of one is high: `FoodNutrient.nutrientKey` is a foreign key onto the nutrient
 * catalogue, so a single unknown key raises a constraint violation that aborts
 * the whole import rather than skipping one value. Anything that would not be
 * written is rejected here, where it can be reported per record.
 */
const valueSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.number().finite().nonnegative(),
  sourceUrl: z.string().url().max(2000).nullish(),
  model: z.string().max(200).nullish(),
  retrievedAt: z.string().max(40).nullish(),
});

/**
 * Values are checked one at a time rather than as a typed array, so a single
 * unusable number costs that nutrient and not the whole food's contribution.
 */
const recordSchema = z.object({
  provider: z.string().min(1).max(64),
  externalId: z.string().min(1).max(200),
  name: z.string().max(400).optional(),
  values: z.array(z.unknown()).max(200),
});

export type EnrichmentValue = z.infer<typeof valueSchema>;
export type EnrichmentRecord = Omit<z.infer<typeof recordSchema>, "values"> & { values: EnrichmentValue[] };

export interface EnrichmentImportStats {
  /** Nutrient values the database confirms were written into a gap. */
  filled: number;
  /** Values skipped because the food already had that nutrient. */
  alreadyPresent: number;
  /** Records naming a food this instance does not have. */
  unknownFoods: number;
  /** Records or values the artifact should not have contained. */
  rejected: number;
  issues: string[];
}

export interface EnrichmentImportOutcome {
  key: string;
  version: string;
  changed: boolean;
  records: number;
  durationMs: number;
  stats: EnrichmentImportStats;
}

const MAX_REPORTED_ISSUES = 20;

/** Adds a diagnostic line, keeping the collection bounded on a bad artifact. */
function report(stats: EnrichmentImportStats, message: string) {
  stats.rejected++;
  if (stats.issues.length < MAX_REPORTED_ISSUES) stats.issues.push(message);
}

/**
 * Validates and de-duplicates one chunk of the artifact.
 *
 * Both halves matter. A record the schema rejects is reported rather than
 * dereferenced - a `null` inside `values` used to throw a `TypeError` out of
 * the whole import. And a nutrient named twice, or a food named twice, would
 * otherwise be counted twice while the database wrote it once, so the numbers
 * an administrator reads would not describe what happened.
 */
function prepare(records: unknown[], knownKeys: ReadonlySet<string>, stats: EnrichmentImportStats) {
  const byIdentity = new Map<string, EnrichmentRecord>();

  for (const raw of records) {
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success) {
      report(stats, `record rejected: ${parsed.error.issues[0]?.message ?? "not in the artifact shape"}`);
      continue;
    }
    const record = parsed.data;
    const identity = `${record.provider}\u0000${record.externalId}`;

    const seen = new Set<string>();
    const values: EnrichmentValue[] = [];
    for (const raw of record.values) {
      const value = valueSchema.safeParse(raw);
      if (!value.success) {
        // Named where it can be: whoever has to correct the artifact needs to
        // know which nutrient, not only that something in the list was wrong.
        const key = (raw as { key?: unknown } | null)?.key;
        const named = typeof key === "string" ? `"${key}"` : "an unnamed entry";
        report(stats, `${record.provider}/${record.externalId}: unusable value for ${named} (${value.error.issues[0]?.message ?? "malformed"})`);
        continue;
      }
      // An unknown key is not a value this instance can merely skip at write
      // time: `nutrientKey` is a foreign key onto the catalogue, so queueing one
      // raises a constraint violation that takes the entire import down with it.
      if (!knownKeys.has(value.data.key)) {
        report(stats, `${record.provider}/${record.externalId}: no nutrient "${value.data.key}" in this catalogue`);
        continue;
      }
      if (seen.has(value.data.key)) {
        report(stats, `${record.provider}/${record.externalId}: nutrient "${value.data.key}" appears more than once`);
        continue;
      }
      seen.add(value.data.key);
      values.push(value.data);
    }

    const existing = byIdentity.get(identity);
    if (existing) {
      report(stats, `${record.provider}/${record.externalId}: named more than once in the artifact`);
      // Merge rather than drop, so a duplicated record cannot quietly lose data.
      const merged = new Set(existing.values.map((value) => value.key));
      existing.values.push(...values.filter((value) => !merged.has(value.key)));
      continue;
    }
    byIdentity.set(identity, { ...record, values });
  }

  return byIdentity;
}

async function writeChunk(records: unknown[], knownKeys: ReadonlySet<string>, retrievedAt: Date, stats: EnrichmentImportStats) {
  const byIdentity = prepare(records, knownKeys, stats);
  const valid = [...byIdentity.values()];
  if (!valid.length) return;

  // Matched on the identity the food's own dataset gave it, never on a name.
  const foods = await prisma.food.findMany({
    where: {
      OR: valid.map((record) => ({ externalProvider: record.provider, externalId: record.externalId })),
    },
    select: { id: true, externalProvider: true, externalId: true, nutrients: { select: { nutrientKey: true, value: true } } },
  });
  const foodByIdentity = new Map(foods.map((food) => [`${food.externalProvider}\u0000${food.externalId}`, food]));

  // Each planned write, kept with the food and key it belongs to so the counts
  // and the provenance can be built from what the database actually did rather
  // than from what was intended.
  const fills: { foodId: string; nutrientKey: string; value: number; url: string | null; model: string | null; existing: boolean }[] = [];

  for (const [identity, record] of byIdentity) {
    const food = foodByIdentity.get(identity);
    if (!food) {
      stats.unknownFoods++;
      continue;
    }
    const present = new Map(food.nutrients.map((nutrient) => [nutrient.nutrientKey, nutrient.value]));

    for (const value of record.values) {
      const existing = present.get(value.key);
      // A nutrient the food already states is left exactly as it is - a
      // measured number always beats a read one, and a value another instance's
      // model produced is not evidence against this instance's data.
      if (existing !== undefined && existing !== null) {
        stats.alreadyPresent++;
        continue;
      }
      fills.push({
        foodId: food.id,
        nutrientKey: value.key,
        value: value.value,
        url: value.sourceUrl ?? null,
        model: value.model ?? null,
        // The row exists and is explicitly unknown, so it is updated rather
        // than created - still only while it is empty.
        existing: existing === null,
      });
    }
  }

  if (!fills.length) return;

  const updates = fills.filter((fill) => fill.existing);
  const creates = fills.filter((fill) => !fill.existing);

  // One transaction, then the counts. `updateMany` reports how many rows it
  // matched and `createMany` how many it inserted, so a value another writer
  // filled first is neither counted nor cited by the provenance row below.
  const results = await prisma.$transaction([
    ...updates.map((fill) =>
      prisma.foodNutrient.updateMany({
        where: { foodId: fill.foodId, nutrientKey: fill.nutrientKey, value: null },
        data: { value: fill.value, origin: AI_ENRICHMENT_ORIGIN },
      }),
    ),
    // `skipDuplicates` rather than a pre-check: another importer may have
    // created the same row between the read above and this write.
    //
    // One statement per fill, matching the updates above, because a batched
    // `createMany` reports only a total: a single racing duplicate then made it
    // impossible to say which of the others had gone in, and the whole batch
    // had to be left uncounted. Attribution is worth the extra statements, and
    // the update path already pays them.
    ...creates.map((fill) =>
      prisma.foodNutrient.createMany({
        data: [{ foodId: fill.foodId, nutrientKey: fill.nutrientKey, value: fill.value, origin: AI_ENRICHMENT_ORIGIN }],
        skipDuplicates: true,
      }),
    ),
  ]);

  const written = new Map<string, { keys: string[]; url: string | null; model: string | null }>();
  const note = (fill: (typeof fills)[number]) => {
    const entry = written.get(fill.foodId) ?? { keys: [], url: null, model: null };
    entry.keys.push(fill.nutrientKey);
    entry.url ??= fill.url;
    entry.model ??= fill.model;
    written.set(fill.foodId, entry);
  };

  updates.forEach((fill, index) => {
    if ((results[index] as { count: number }).count > 0) note(fill);
  });
  creates.forEach((fill, index) => {
    if ((results[updates.length + index] as { count: number }).count > 0) note(fill);
  });

  stats.filled += [...written.values()].reduce((total, entry) => total + entry.keys.length, 0);

  const sourceRows: Prisma.FoodSourceCreateManyInput[] = [...written].map(([foodId, entry]) => ({
    id: randomUUID(),
    foodId,
    provider: ENRICHMENT_PROVIDER,
    retrievedAt,
    url: entry.url,
    estimated: true,
    model: entry.model,
    metadata: { nutrientKeys: entry.keys, bundled: true, addedAt: retrievedAt.toISOString() },
  }));
  if (sourceRows.length) await prisma.foodSource.createMany({ data: sourceRows, skipDuplicates: true });
}

/**
 * Applies the bundled enrichment artifact, if this build ships one.
 *
 * Absent is the normal case - the artifact is only present once somebody has
 * contributed one - so a missing manifest entry is not an error.
 */
export async function importEnrichmentDataset(options: { force?: boolean } = {}): Promise<EnrichmentImportOutcome | null> {
  const started = Date.now();
  const entry = readManifestEntry(ENRICHMENT_DATASET_KEY);
  if (!entry) return null;

  const previous = await prisma.datasetImport.findUnique({ where: { key: ENRICHMENT_DATASET_KEY } });
  if (!options.force && previous?.checksum === entry.artifactSha256) {
    return {
      key: ENRICHMENT_DATASET_KEY,
      version: entry.version,
      changed: false,
      records: previous.recordCount,
      durationMs: Date.now() - started,
      stats: { filled: 0, alreadyPresent: 0, unknownFoods: 0, rejected: 0, issues: [] },
    };
  }

  const stats: EnrichmentImportStats = { filled: 0, alreadyPresent: 0, unknownFoods: 0, rejected: 0, issues: [] };
  const retrievedAt = new Date();
  let records = 0;

  // The catalogue this instance actually has. A key outside it is a foreign
  // key violation waiting to happen, so it is checked before anything is written.
  const knownKeys = new Set(
    (await prisma.nutrientDefinition.findMany({ select: { key: true } })).map((definition) => definition.key),
  );

  // Read as `unknown`: what the file claims is not what the schema accepts.
  for await (const chunk of readDatasetChunks<unknown>(entry.artifact)) {
    records += chunk.length;
    await writeChunk(chunk, knownKeys, retrievedAt, stats);
  }

  const durationMs = Date.now() - started;
  const statsJson = stats as unknown as Prisma.InputJsonValue;
  await prisma.datasetImport.upsert({
    where: { key: ENRICHMENT_DATASET_KEY },
    create: { key: ENRICHMENT_DATASET_KEY, version: entry.version, checksum: entry.artifactSha256, recordCount: records, stats: statsJson, durationMs },
    update: { version: entry.version, checksum: entry.artifactSha256, recordCount: records, stats: statsJson, durationMs },
  });

  logger.info("Imported bundled enrichment artifact", {
    version: entry.version,
    records,
    filled: stats.filled,
    alreadyPresent: stats.alreadyPresent,
    unknownFoods: stats.unknownFoods,
    rejected: stats.rejected,
    durationMs,
  });

  return { key: ENRICHMENT_DATASET_KEY, version: entry.version, changed: true, records, durationMs, stats };
}
