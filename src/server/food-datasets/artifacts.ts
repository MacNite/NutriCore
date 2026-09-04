/**
 * Locating and streaming the bundled food-database artifacts.
 *
 * `datasets/bundled` holds what `scripts/convert-food-datasets.mjs` produced:
 * gzipped newline-delimited JSON plus a manifest that records each dataset's
 * version, record count and checksum. The checksum is what makes the import
 * idempotent, so it is read from the manifest rather than recomputed.
 */
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { createGunzip } from "node:zlib";

export interface DatasetManifestEntry {
  version: string;
  artifact: string;
  components?: string;
  records: number;
  artifactSha256: string;
  generatedAt?: string;
  sources?: { file: string; sha256: string; bytes: number }[];
}

export interface DatasetManifest {
  datasets: Record<string, DatasetManifestEntry>;
}

/**
 * Where the artifacts live, overridable for tests and for a deployment that
 * mounts them elsewhere.
 */
export const datasetDirectory = () =>
  resolve(process.env.FOOD_DATASET_DIR?.trim() || join(process.cwd(), "datasets", "bundled"));

export const manifestPath = () => join(datasetDirectory(), "manifest.json");

export function readManifest(): DatasetManifest | null {
  const path = manifestPath();
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as DatasetManifest;
  return { datasets: parsed.datasets ?? {} };
}

export function readManifestEntry(key: string): DatasetManifestEntry | null {
  return readManifest()?.datasets[key] ?? null;
}

/** Reads the BLS component reference that accompanies the food artifact. */
export function readJsonSidecar<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(datasetDirectory(), fileName), "utf8")) as T;
}

/**
 * Yields the artifact's records in chunks.
 *
 * Chunked rather than one at a time because the importer writes in batches: a
 * per-food round trip for 15,296 foods is thousands of times slower than a
 * handful of statements per chunk, and this import runs on deployment.
 */
export async function* readDatasetChunks<T>(fileName: string, chunkSize = 250): AsyncGenerator<T[]> {
  const path = join(datasetDirectory(), fileName);
  if (!existsSync(path)) throw new Error(`Missing bundled dataset artifact: ${path}`);

  const lines = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let chunk: T[] = [];
  for await (const line of lines) {
    if (line.trim() === "") continue;
    chunk.push(JSON.parse(line) as T);
    if (chunk.length >= chunkSize) {
      yield chunk;
      chunk = [];
    }
  }
  if (chunk.length > 0) yield chunk;
}
