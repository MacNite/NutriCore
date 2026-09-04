/**
 * The numbers the site is allowed to state.
 *
 * Every figure on the marketing site is read out of the repository at build
 * time rather than typed into a page, because a number typed into a page is a
 * number that goes stale silently. `datasets/bundled/manifest.json` already
 * records what each food database contains; `src/lib/nutrients.ts` already is
 * the nutrient catalogue; `prisma/schema.prisma` already is the data model. If
 * one of them changes, the next build says so on its own.
 *
 * Nothing here parses TypeScript. The two source files it reads are counted by
 * a deliberately narrow regular expression anchored to the shape those files
 * actually have, and every read falls back rather than throwing: a website must
 * still build from a shallow checkout that omits the dataset artifacts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  } catch {
    return fallback;
  }
};

const readText = (path) => {
  try {
    return readFileSync(join(ROOT, path), "utf8");
  } catch {
    return "";
  }
};

const countMatches = (text, pattern) => (text.match(pattern) ?? []).length;

/** Recursive file count, used for "how much of this is tests" figures. */
function countFiles(directory, predicate) {
  const absolute = join(ROOT, directory);
  if (!existsSync(absolute)) return 0;
  let total = 0;
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) total += countFiles(join(directory, entry), predicate);
    else if (predicate(entry)) total += 1;
  }
  return total;
}

const manifest = readJson("datasets/bundled/manifest.json", { datasets: {} });
const pkg = readJson("package.json", { version: "0.0.0", dependencies: {}, devDependencies: {} });
const nutrientSource = readText("src/lib/nutrients.ts");
const schema = readText("prisma/schema.prisma");
const dockerfile = readText("Dockerfile");

const dataset = (id) => manifest.datasets?.[id] ?? { records: 0, version: "unknown" };

const bls = dataset("bls");
const usdaFoundation = dataset("usda-foundation");
const usdaLegacy = dataset("usda-sr-legacy");

const bundledFoods = bls.records + usdaFoundation.records + usdaLegacy.records;

/** `node:22.19.0-alpine` -> `22.19.0`, so the docs page cannot claim the wrong runtime. */
const nodeVersion = (dockerfile.match(/FROM node:([\d.]+)-alpine/) ?? [, "22"])[1];

export const facts = {
  version: pkg.version,
  repo: "https://github.com/MacNite/NutriCore",
  registry: "ghcr.io/macnite/nutricore",
  nodeVersion,
  postgresVersion: (readText("docker-compose.yml").match(/image: postgres:([\d.]+)-alpine/) ?? [, "17.6"])[1],

  foods: {
    total: bundledFoods,
    bls: { records: bls.records, version: bls.version, components: bls.componentCount ?? 0 },
    usda: {
      records: usdaFoundation.records + usdaLegacy.records,
      foundation: usdaFoundation.records,
      legacy: usdaLegacy.records,
      version: usdaFoundation.version,
    },
  },

  // `{ key: "energyKcal", ... }` - one row per nutrient in the canonical catalogue.
  nutrients: countMatches(nutrientSource, /\{\s*key:\s*"/g),
  vitamins: countMatches(nutrientSource, /category:\s*"vitamin"/g),
  minerals: countMatches(nutrientSource, /category:\s*"mineral"/g),

  models: countMatches(schema, /^model\s/gm),
  locales: ["Deutsch", "English"],

  tests: countFiles("src", (name) => name.endsWith(".test.ts")) + countFiles("tests", (name) => name.endsWith(".test.ts")),
  e2eSuites: countFiles("e2e", (name) => name.endsWith(".spec.ts")),

  /** Written down once so the same claim cannot be phrased two ways. */
  license: "Source-available. No license has been selected yet - see LICENSE.",
};

/** Thousands separators, in the locale the site is written in. */
export const num = (value) => value.toLocaleString("en-US");
