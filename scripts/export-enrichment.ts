/**
 * Writes this instance's approved nutrition backfill into a bundled artifact.
 *
 *     npm run datasets:export:enrichment
 *
 * The artifact is the contribution path: run this on an instance whose
 * administrator has reviewed its backfill, commit the two files it writes, and
 * open a pull request. Shipping a value to every NutriCore is a separate
 * decision from approving it for one instance, and a pull request is where that
 * second decision gets made - which is why this writes a file and stops rather
 * than pushing anything anywhere.
 *
 * Only catalogue foods travel: a BLS code or an FDC id means the same food on
 * every deployment, and a food somebody created has no such identity. Nothing
 * private can reach the artifact by construction.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { prisma } from "../src/lib/db";
import { collectEnrichmentExport, enrichmentNdjson } from "../src/server/enrichment-export";
import { ENRICHMENT_DATASET_KEY } from "../src/server/food-datasets/enrichment";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED = join(ROOT, "datasets", "bundled");
const ARTIFACT = "ai-enrichment.ndjson.gz";

async function main() {
  const foods = await collectEnrichmentExport();
  const values = foods.reduce((total, food) => total + food.values.length, 0);

  if (!foods.length) {
    process.stdout.write("No approved backfill on any catalogue food - nothing to export.\n");
    return;
  }

  mkdirSync(BUNDLED, { recursive: true });
  // Node's gzip writes a zero header timestamp, so an unchanged catalogue
  // produces identical bytes and therefore an identical checksum: the repo diff
  // shows only real changes, and a re-import of unchanged data costs one query.
  // The records are sorted for the same reason.
  const artifact = gzipSync(Buffer.from(enrichmentNdjson(foods)), { level: 9 });
  writeFileSync(join(BUNDLED, ARTIFACT), artifact);

  const manifestPath = join(BUNDLED, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { datasets: {} };
  manifest.datasets ??= {};
  manifest.datasets[ENRICHMENT_DATASET_KEY] = {
    version: `AI enrichment, ${new Date().toISOString().slice(0, 10)}`,
    artifact: ARTIFACT,
    records: foods.length,
    artifactSha256: createHash("sha256").update(artifact).digest("hex"),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(
    `Wrote ${join(BUNDLED, ARTIFACT)}: ${values} values across ${foods.length} foods.\n` +
      "Commit datasets/bundled/ai-enrichment.ndjson.gz and manifest.json, then open a pull request.\n",
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
