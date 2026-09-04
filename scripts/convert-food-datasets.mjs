#!/usr/bin/env node
/**
 * Turns the upstream food databases in `datasets/raw` into the compact,
 * versioned artifacts in `datasets/bundled` that NutriCore actually ships.
 *
 *     node scripts/convert-food-datasets.mjs [bls|usda|all]
 *
 * Why a conversion step instead of importing the originals directly:
 *
 *  - BLS 4.0 arrives as a 14 MB .xlsx whose single sheet inflates to 99 MB of
 *    XML. Parsing that on every deployment would mean shipping the workbook and
 *    a spreadsheet reader in the runtime image for no benefit.
 *  - The USDA downloads are 208 MB of JSON carrying derivation prose, footnotes
 *    and attribute tables the app never reads.
 *  - An artifact under version control is diffable, checksummed and identical
 *    on every machine, which is what makes the import reproducible.
 *
 * This script deliberately performs NO nutritional interpretation: it does not
 * map nutrients, convert units or decide what a missing value means. It
 * transcribes the source faithfully - strings such as `-`, `TR` and `<LOD` are
 * carried through exactly as the source wrote them - and leaves every semantic
 * decision to the importer in `src/server/food-datasets`, where it can be unit
 * tested against these very files.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { readSheetRows } from "./lib/xlsx.mjs";
import { iterateJsonArray } from "./lib/json-array-stream.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "datasets", "raw");
const BUNDLED = join(ROOT, "datasets", "bundled");

/**
 * The BLS release this conversion is written against. It is recorded in the
 * manifest and surfaced in the UI, so a dataset refresh is visible rather than
 * silent.
 */
const BLS_VERSION = "4.0 (2025)";
const BLS_DATA_FILE = "BLS_4_0_Daten_2025_DE.xlsx";
const BLS_COMPONENTS_FILE = "BLS_4_0_Components_DE_EN.xlsx";

const USDA_SOURCES = {
  "usda-foundation": {
    version: "FoodData Central Foundation Foods, 2026-04-30",
    property: "FoundationFoods",
    files: ["FoodData_Central_foundation_food_json_2026-04-30.json"],
  },
  "usda-sr-legacy": {
    version: "FoodData Central SR Legacy, April 2018",
    property: "SRLegacyFoods",
    // Four parts of one JSON document; only the concatenation is valid.
    files: [1, 2, 3, 4].map((part) => `FoodData_Central_sr_legacy_food_json_2018-04_${part}_4.json`),
  },
};

const sha256 = (input) => createHash("sha256").update(input).digest("hex");

function sha256File(path) {
  return sha256(readFileSync(path));
}

/** Writes newline-delimited JSON, gzipped. */
async function writeNdjsonGz(path, records) {
  const source = Readable.from(
    (function* () {
      for (const record of records) yield `${JSON.stringify(record)}\n`;
    })(),
  );
  await pipeline(source, createGzip({ level: 9 }), createWriteStream(path));
}

async function hashFile(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** `"ENERCJ Energie (Kilojoule) [kJ/100g]"` -> `"ENERCJ"`. */
const componentCode = (header) => header.split(" ")[0];

/**
 * The BLS value columns are mixed-type on purpose, and the distinction is the
 * whole point of the dataset: a number is a value, `-` means the nutrient was
 * never determined, `TR` means traces, `<LOD`/`<LOQ` mean below the detection
 * or quantification limit. All four are preserved verbatim.
 */
function convertBls() {
  const dataPath = join(RAW, BLS_DATA_FILE);
  const componentsPath = join(RAW, BLS_COMPONENTS_FILE);
  for (const path of [dataPath, componentsPath]) {
    if (!existsSync(path)) throw new Error(`Missing BLS source file: ${path}`);
  }

  // The bilingual component reference: code, names, unit, group and formula.
  const components = [];
  let componentHeader = null;
  for (const row of readSheetRows(componentsPath)) {
    if (!componentHeader) {
      componentHeader = row;
      continue;
    }
    const code = row[1];
    if (!code) continue;
    components.push({
      index: typeof row[0] === "number" ? row[0] : Number(row[0]),
      code: String(code).trim(),
      nameDe: String(row[2] ?? "").trim(),
      nameEn: String(row[3] ?? "").trim(),
      unit: String(row[4] ?? "").trim(),
      groupDe: String(row[5] ?? "").trim(),
      groupEn: String(row[6] ?? "").trim(),
      formula: String(row[7] ?? "").trim() || null,
    });
  }

  const foods = [];
  let header = null;
  /** Column index -> component code, for the value columns only. */
  let valueColumns = [];
  let sourceColumns = new Map();
  let noteColumn = -1;

  for (const row of readSheetRows(dataPath)) {
    if (!header) {
      header = row;
      row.forEach((name, index) => {
        if (typeof name !== "string" || index < 3) return;
        if (name === "Hinweis") {
          noteColumn = index;
        } else if (name.endsWith(" Datenherkunft")) {
          sourceColumns.set(componentCode(name), index);
        } else if (!name.endsWith(" Referenz")) {
          valueColumns.push([componentCode(name), index]);
        }
      });
      continue;
    }
    if (!row[0]) continue;

    // `[value, dataSourceCategory]` per component. The per-nutrient literature
    // reference column is intentionally dropped: it repeats the same handful of
    // citations tens of thousands of times, and the data-source category is the
    // part that carries the quality signal the app uses.
    const values = {};
    for (const [code, index] of valueColumns) {
      const raw = row[index];
      if (raw === undefined || raw === "") continue;
      const value = typeof raw === "number" ? raw : String(raw).trim();
      const origin = row[sourceColumns.get(code) ?? -1];
      values[code] = [value, typeof origin === "string" ? origin.trim() : null];
    }

    foods.push({
      code: String(row[0]).trim(),
      nameDe: String(row[1] ?? "").trim(),
      nameEn: String(row[2] ?? "").trim(),
      note: noteColumn >= 0 && typeof row[noteColumn] === "string" ? row[noteColumn].trim() || null : null,
      values,
    });
  }

  if (foods.length === 0) throw new Error("The BLS workbook produced no rows");

  return {
    key: "bls",
    version: BLS_VERSION,
    components,
    foods,
    sources: [
      { file: BLS_DATA_FILE, sha256: sha256File(dataPath), bytes: statSync(dataPath).size },
      { file: BLS_COMPONENTS_FILE, sha256: sha256File(componentsPath), bytes: statSync(componentsPath).size },
    ],
  };
}

/**
 * Keeps the fields NutriCore reads and drops the rest: derivation prose,
 * footnotes, input-food tables and attribute lists account for most of the
 * download's size and none of its nutritional content.
 */
function slimUsdaFood(food) {
  const nutrients = [];
  for (const entry of food.foodNutrients ?? []) {
    const nutrient = entry?.nutrient;
    if (!nutrient || typeof entry.amount !== "number") continue;
    nutrients.push([nutrient.id, nutrient.number ?? null, nutrient.unitName ?? null, entry.amount]);
  }

  const portions = [];
  for (const portion of food.foodPortions ?? []) {
    if (typeof portion?.gramWeight !== "number") continue;
    portions.push({
      amount: typeof portion.amount === "number" ? portion.amount : null,
      unit: portion.measureUnit?.name ?? null,
      abbreviation: portion.measureUnit?.abbreviation ?? null,
      modifier: typeof portion.modifier === "string" && portion.modifier.trim() !== "" ? portion.modifier.trim() : null,
      gramWeight: portion.gramWeight,
      sequence: typeof portion.sequenceNumber === "number" ? portion.sequenceNumber : null,
    });
  }

  return {
    fdcId: food.fdcId,
    dataType: food.dataType ?? null,
    description: food.description ?? "",
    category:
      typeof food.foodCategory === "string" ? food.foodCategory : (food.foodCategory?.description ?? null),
    ndbNumber: food.ndbNumber ?? null,
    publicationDate: food.publicationDate ?? null,
    nutrients,
    portions,
  };
}

function convertUsda(key) {
  const definition = USDA_SOURCES[key];
  const paths = definition.files.map((file) => join(RAW, file));
  for (const path of paths) {
    if (!existsSync(path)) throw new Error(`Missing USDA source file: ${path}`);
  }

  const buffer = paths.length === 1 ? readFileSync(paths[0]) : Buffer.concat(paths.map((path) => readFileSync(path)));

  const foods = [];
  let holes = 0;
  for (const food of iterateJsonArray(buffer, definition.property)) {
    // The Foundation download ends with a run of nulls.
    if (!food || typeof food !== "object") {
      holes += 1;
      continue;
    }
    if (typeof food.fdcId !== "number" || !food.description) {
      holes += 1;
      continue;
    }
    foods.push(slimUsdaFood(food));
  }

  if (foods.length === 0) throw new Error(`${key} produced no rows`);

  return {
    key,
    version: definition.version,
    foods,
    holes,
    sources: definition.files.map((file, index) => ({
      file,
      sha256: sha256File(paths[index]),
      bytes: statSync(paths[index]).size,
    })),
  };
}

async function main() {
  const requested = (process.argv[2] ?? "all").toLowerCase();
  mkdirSync(BUNDLED, { recursive: true });

  const manifestPath = join(BUNDLED, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { datasets: {} };
  manifest.datasets ??= {};

  const wanted = (key) => requested === "all" || requested === key || (requested === "usda" && key.startsWith("usda-"));

  if (wanted("bls")) {
    process.stdout.write("Converting BLS 4.0... ");
    const result = convertBls();
    const artifact = join(BUNDLED, "bls-4.0.ndjson.gz");
    await writeNdjsonGz(artifact, result.foods);
    writeFileSync(
      join(BUNDLED, "bls-4.0-components.json"),
      `${JSON.stringify({ version: result.version, components: result.components }, null, 2)}\n`,
    );
    manifest.datasets.bls = {
      version: result.version,
      artifact: "bls-4.0.ndjson.gz",
      components: "bls-4.0-components.json",
      records: result.foods.length,
      componentCount: result.components.length,
      artifactSha256: await hashFile(artifact),
      sources: result.sources,
      generatedAt: new Date().toISOString(),
    };
    process.stdout.write(`${result.foods.length} foods, ${result.components.length} components\n`);
  }

  for (const key of Object.keys(USDA_SOURCES)) {
    if (!wanted(key)) continue;
    process.stdout.write(`Converting ${key}... `);
    const result = convertUsda(key);
    const artifact = join(BUNDLED, `${key}.ndjson.gz`);
    await writeNdjsonGz(artifact, result.foods);
    manifest.datasets[key] = {
      version: result.version,
      artifact: `${key}.ndjson.gz`,
      records: result.foods.length,
      skipped: result.holes,
      artifactSha256: await hashFile(artifact),
      sources: result.sources,
      generatedAt: new Date().toISOString(),
    };
    process.stdout.write(`${result.foods.length} foods (${result.holes} empty entries skipped)\n`);
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Wrote ${manifestPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
