#!/usr/bin/env node
/**
 * Builds the NutriCore website into `website/dist`.
 *
 *     node website/build.mjs [--check]
 *
 * There is no framework and no dependency, on purpose. The site is three pages
 * whose content is HTML; what it actually needs from a build step is the one
 * thing hand-written HTML cannot do - read the repository, so that every figure
 * on the site is the repository's own figure rather than a number somebody
 * typed a year ago (see src/data.mjs).
 *
 * `--check` additionally verifies the output: no internal link points at a page
 * that was not emitted, no referenced asset is missing, and no page is empty.
 * The website workflow runs it that way, so a broken link fails the build
 * instead of reaching a visitor.
 */
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { facts, num } from "./src/data.mjs";
import { home } from "./src/pages/home.mjs";
import { demo } from "./src/pages/demo.mjs";
import { build as buildPage } from "./src/pages/build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "dist");
const ASSETS = join(DIST, "assets");
const ROOT = resolve(HERE, "..");

const PAGES = {
  "index.html": home,
  "demo.html": demo,
  "build.html": buildPage,
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(ASSETS, { recursive: true });

for (const [name, html] of Object.entries(PAGES)) {
  writeFileSync(join(DIST, name), html, "utf8");
}

// The stylesheet and the scripts, verbatim.
cpSync(join(HERE, "src", "assets"), ASSETS, { recursive: true });

// The application's own icon, so the site and the app share one mark.
cpSync(join(ROOT, "public", "icon.svg"), join(ASSETS, "icon.svg"));

/**
 * GitHub Pages runs Jekyll over an artifact unless told not to, and Jekyll
 * drops files and directories beginning with an underscore.
 */
writeFileSync(join(DIST, ".nojekyll"), "", "utf8");

writeFileSync(
  join(DIST, "robots.txt"),
  "User-agent: *\nAllow: /\n",
  "utf8",
);

/* --- Verification ---------------------------------------------------------
   Cheap, and it catches the two mistakes a hand-written site actually makes:
   a link to a page that was renamed, and an asset that was never copied. */

function checkOutput() {
  const emitted = new Set(Object.keys(PAGES));
  const problems = [];

  const assetFiles = new Set();
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${entry}/`);
      else assetFiles.add(`${prefix}${entry}`);
    }
  };
  walk(ASSETS, "assets/");

  for (const [name, html] of Object.entries(PAGES)) {
    if (html.length < 4000) problems.push(`${name} is suspiciously short (${html.length} bytes)`);
    if (!html.includes("<title>")) problems.push(`${name} has no title`);

    // Every href and src that is neither absolute nor a fragment.
    const references = html.matchAll(/(?:href|src)="(?!https?:|mailto:|#|data:)([^"#?]+)/g);
    for (const [, reference] of references) {
      if (emitted.has(reference) || assetFiles.has(reference)) continue;
      problems.push(`${name} references a missing target: ${reference}`);
    }
  }

  return problems;
}

const bytes = Object.values(PAGES).reduce((total, html) => total + Buffer.byteLength(html), 0);
console.log(`NutriCore website -> ${DIST}`);
console.log(
  `  ${Object.keys(PAGES).length} pages, ${(bytes / 1024).toFixed(1)} kB of HTML` +
    `  ·  ${num(facts.foods.total)} foods, ${facts.nutrients} nutrients, ${facts.models} models read from the repository`,
);

if (process.argv.includes("--check")) {
  const problems = checkOutput();
  if (problems.length) {
    console.error("\nThe build produced a page that would be broken:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("  check: internal links and assets resolve");
}
