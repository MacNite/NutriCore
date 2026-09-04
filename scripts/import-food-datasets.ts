/**
 * Imports the bundled food databases into PostgreSQL.
 *
 *     npm run db:import:foods            # every bundled dataset
 *     npm run db:import:foods -- bls     # one of them
 *     npm run db:import:foods -- --force # re-import an unchanged dataset
 *
 * Safe to run on every deployment: a dataset whose checksum matches the last
 * import is skipped without reading the artifact.
 */
import { prisma } from "../src/lib/db";
import { DATASET_KEYS, importAllDatasets } from "../src/server/food-datasets/import";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const keys = args.filter((arg) => !arg.startsWith("--"));

  const unknown = keys.filter((key) => !DATASET_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`Unknown dataset(s): ${unknown.join(", ")}. Known: ${DATASET_KEYS.join(", ")}`);
  }

  const { outcomes, failures } = await importAllDatasets({
    force,
    keys: keys.length > 0 ? keys : undefined,
  });

  for (const outcome of outcomes) {
    if (!outcome.changed) {
      process.stdout.write(`${outcome.key}: already imported (${outcome.version}), ${outcome.records} foods\n`);
      continue;
    }
    const { created, updated, skipped, stale } = outcome.stats;
    process.stdout.write(
      `${outcome.key}: ${outcome.version} - ${created} created, ${updated} updated, ` +
        `${skipped} skipped, ${stale} no longer in the release, in ${(outcome.durationMs / 1000).toFixed(1)}s\n`,
    );
    if (outcome.stats.issues.length > 0) {
      process.stdout.write(`  issues: ${outcome.stats.issues.slice(0, 5).join("; ")}\n`);
    }
    if (outcome.stats.unmapped.length > 0) {
      const sample = outcome.stats.unmapped
        .slice(0, 8)
        .map(([field, count]) => `${field} (${count})`)
        .join(", ");
      process.stdout.write(`  source fields no nutrient key claims: ${sample}\n`);
    }
  }

  for (const failure of failures) {
    process.stderr.write(`${failure.key}: FAILED - ${failure.error}\n`);
  }

  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
