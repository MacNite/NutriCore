# Upstream food-database downloads

These are the original, unmodified files the bundled artifacts in
`../bundled` are generated from. They are a **build input**, not something the
application reads at runtime: they are excluded from the Docker image
(`.dockerignore`) and are deliberately not under `public/`, which Next.js serves
to anyone who can reach the deployment.

Downloaded 4 September 2026 from:

- <https://blsdb.de/download> — Bundeslebensmittelschlüssel (BLS) 4.0
- <https://fdc.nal.usda.gov/download-datasets> — USDA FoodData Central

## Files

| File | Contents |
| --- | --- |
| `BLS_4_0_Daten_2025_DE.xlsx` | BLS 4.0 main table: 7,140 foods × 138 nutrient components, each with a value, a data-source category and a literature reference |
| `BLS_4_0_Components_DE_EN.xlsx` | BLS 4.0 bilingual component reference: code, German and English name, unit, group, calculation formula |
| `BLS_4_0_Dokumentation_DE.pdf` | BLS 4.0 reference manual (Max Rubner-Institut, December 2025) |
| `FoodData_Central_foundation_food_json_2026-04-30.json` | Foundation Foods, 363 records |
| `FoodData_Central_sr_legacy_food_json_2018-04_?_4.json` | SR Legacy, 7,793 records. **One JSON document split across four files** — only the concatenation is valid JSON |
| `FoodData_Central_surveyDownload.json` | FNDDS survey foods. Present for reference; **not imported** (mixed-dish survey data) |

## Licensing

The BLS 4.0 documentation lists among the changes for version 4.0
_"Kostenfreie und lizenzfreie Bereitstellung"_ (provision free of charge and
free of licence) and states no restriction on redistribution. NutriCore
attributes the Max Rubner-Institut in About → Data sources.

USDA FoodData Central data is generally in the public domain (CC0); it is
attributed there as well.

## Refreshing a dataset

1. Replace the file(s) here with the new download.
2. Update the version string and file names in
   `scripts/convert-food-datasets.mjs`.
3. Run `npm run datasets:convert` and commit the regenerated
   `datasets/bundled/*` — the manifest records a checksum of both the source
   and the artifact.
4. Run `npm run db:import:foods` (or use Admin → Food databases). The import is
   idempotent: it reconciles the existing rows instead of duplicating them.
