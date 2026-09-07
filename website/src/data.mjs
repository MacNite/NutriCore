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
const envExample = readText(".env.example");
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

  /**
   * Documented settings in `.env.example`, commented-out defaults included:
   * a commented line is still a setting the file tells you how to use.
   */
  settings: countMatches(envExample, /^#?[A-Z][A-Z0-9_]*=/gm),

  locales: ["Deutsch", "English"],

  tests: countFiles("src", (name) => name.endsWith(".test.ts")) + countFiles("tests", (name) => name.endsWith(".test.ts")),
  e2eSuites: countFiles("e2e", (name) => name.endsWith(".spec.ts")),

  /** Written down once so the same claim cannot be phrased two ways. */
  license: "Source-available. No license has been selected yet - see LICENSE.",
};

/** Thousands separators, in the locale the site is written in. */
export const num = (value) => value.toLocaleString("en-US");

/* --- The application's own words and nutrients -----------------------------
   The demo reproduces the application's screens, so it must not invent labels
   for them: "Breakfast", "Recently used", "Waiting for your approval" are the
   application's strings, read out of its English catalogue at build time. A
   renamed key falls back to the wording passed at the call site rather than
   emitting an empty element, for the same reason every read above falls back:
   the site has to build from a checkout that is missing a file. */

const messages = readJson("messages/en.json", {});

/**
 * One string from `messages/en.json`, with `{placeholders}` filled in.
 *
 * ICU plurals are left to the application: a form the catalogue expresses as
 * `{count, plural, ...}` is answered from the fallback instead of shipping the
 * pattern itself to the page.
 */
export function t(path, values = {}, fallback = "") {
  const found = path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), messages);
  let text = typeof found === "string" && !found.includes(", plural,") ? found : fallback;
  for (const [key, value] of Object.entries(values)) text = text.split(`{${key}}`).join(String(value));
  return text;
}

/**
 * The nutrient catalogue itself, not merely its size: key, English name, unit
 * and category, read row by row out of `src/lib/nutrients.ts`. The regular
 * expression is anchored to the one shape that file has - a single-line object
 * literal per nutrient - and a file it cannot read simply yields no rows.
 */
export const nutrients = [...nutrientSource.matchAll(
  /\{\s*key:\s*"([A-Za-z0-9]+)"[^}]*?nameEn:\s*"([^"]+)",\s*unit:\s*"([^"]+)",\s*category:\s*"([a-z]+)"/g,
)].map(([, key, name, unit, category]) => ({ key, name, unit, category }));

/** What the application's micronutrient panel lists, in the catalogue's order. */
export const micronutrientCatalogue = nutrients.filter(
  (nutrient) => nutrient.category === "mineral" || nutrient.category === "vitamin",
);

/* --- Number formatting ----------------------------------------------------
   The demo runs the application's English locale, so it formats the way
   src/lib/format.ts formats: a thousands separator on energy, at most one
   decimal on a nutrient, and a dash - never a zero - for a value no food
   stated. */

const decimal = (value, digits) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });

export const formatNumber = (value, digits = 1) => decimal(value, digits);
export const formatKcal = (value) => decimal(Math.round(value), 0);
export const formatPercent = (fraction) => `${Math.round(fraction * 100)}%`;

/** `formatDate` in the application, on its English locale: "7 Aug 2026". */
export const formatDate = (date) =>
  new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

export function formatNutrient(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return decimal(value, Math.abs(value) > 0 && Math.abs(value) < 0.1 ? 2 : digits);
}
