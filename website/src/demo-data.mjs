/**
 * The demo fixture.
 *
 * Static on purpose: the demo page has no server, no database and no storage,
 * so what it shows has to be a fixture rather than a session. The shape mirrors
 * what the real screens receive - a day is meal groups of entries, an entry
 * knows which source its numbers came from and whether they are estimated -
 * because the point of the page is the shape of the screen, not the data in it.
 *
 * The foods are real reference entries: BLS codes and USDA identifiers are the
 * genuine ones, so nothing here invents a record that does not exist upstream.
 */

export const profile = {
  name: "Anna Reuter",
  initials: "AR",
  locale: "de",
  targets: { energyKcal: 2404, protein: 150, carbohydrate: 240, fat: 80, fiber: 30 },
  basis: "Mifflin–St Jeor · MODERATE ×1,55 · LOSE −400",
};

export const days = [
  {
    id: "day-1",
    label: "Donnerstag, 4. September",
    short: "Do 04.09.",
    meals: [
      {
        type: "Frühstück",
        entries: [
          { name: "Haferflocken, Vollkorn", detail: "80 g · C-1-2-0", source: "BLS", kcal: 303, protein: 11, carb: 47, fat: 6 },
          { name: "Milch, 1,5 % Fett", detail: "200 ml", source: "BLS", kcal: 94, protein: 7, carb: 10, fat: 3 },
          { name: "Heidelbeeren, roh", detail: "100 g", source: "USDA", kcal: 57, protein: 1, carb: 14, fat: 0 },
        ],
      },
      {
        type: "Mittagessen",
        entries: [
          { name: "Linsen, rot, gekocht", detail: "180 g · C-0-1-2", source: "BLS", kcal: 208, protein: 15, carb: 32, fat: 1 },
          { name: "Olivenöl, nativ extra", detail: "12 g · 1 EL", source: "USDA", kcal: 106, protein: 0, carb: 0, fat: 12 },
          { name: "Vollkornbrot", brand: "Harry", detail: "2 Scheiben · 90 g", source: "OFF", estimated: true, kcal: 328, protein: 11, carb: 55, fat: 4 },
        ],
      },
      {
        type: "Abendessen",
        entries: [
          { name: "Ofengemüse mit Feta", detail: "1 Portion · Rezept", source: "RECIPE", kcal: 486, protein: 19, carb: 34, fat: 29 },
          { name: "Hähnchenbrustfilet, gegart", detail: "150 g", source: "BLS", kcal: 248, protein: 47, carb: 0, fat: 6 },
        ],
      },
      {
        type: "Snacks",
        entries: [
          { name: "Skyr, natur", brand: "Arla", detail: "150 g", source: "OFF", kcal: 96, protein: 17, carb: 6, fat: 0 },
          { name: "Walnusskerne", detail: "20 g", source: "BLS", kcal: 138, protein: 3, carb: 2, fat: 14 },
        ],
      },
    ],
  },
  {
    id: "day-2",
    label: "Mittwoch, 3. September",
    short: "Mi 03.09.",
    meals: [
      {
        type: "Frühstück",
        entries: [
          { name: "Roggenvollkornbrot", detail: "2 Scheiben · 100 g", source: "BLS", kcal: 193, protein: 7, carb: 36, fat: 1 },
          { name: "Frischkäse, 20 % F.i.Tr.", detail: "30 g", source: "BLS", kcal: 42, protein: 4, carb: 1, fat: 3 },
        ],
      },
      {
        type: "Mittagessen",
        entries: [
          { name: "Lachs, gegart", detail: "140 g", source: "USDA", kcal: 293, protein: 35, carb: 0, fat: 17 },
          { name: "Kartoffeln, gekocht", detail: "250 g", source: "BLS", kcal: 175, protein: 5, carb: 38, fat: 0 },
          { name: "Brokkoli, gedünstet", detail: "200 g", source: "BLS", kcal: 68, protein: 6, carb: 8, fat: 1 },
        ],
      },
      {
        type: "Abendessen",
        entries: [
          { name: "Linsensalat mit Feta", detail: "1 Portion · Rezept", source: "RECIPE", kcal: 512, protein: 24, carb: 44, fat: 24 },
        ],
      },
      {
        type: "Snacks",
        entries: [
          { name: "Apfel, roh", detail: "180 g", source: "BLS", kcal: 95, protein: 0, carb: 22, fat: 0 },
          { name: "Mandeln", detail: "25 g", source: "USDA", kcal: 145, protein: 5, carb: 5, fat: 13 },
        ],
      },
    ],
  },
];

/**
 * The micronutrient panel. Reference intakes are the German DGE values the
 * application's own reference table uses; a value the day's foods do not state
 * is null and renders as a dash rather than a zero.
 */
export const micronutrients = [
  { name: "Ballaststoffe", value: 34.2, unit: "g", reference: 30 },
  { name: "Calcium", value: 861, unit: "mg", reference: 1000 },
  { name: "Eisen", value: 14.2, unit: "mg", reference: 15 },
  { name: "Magnesium", value: 412, unit: "mg", reference: 300 },
  { name: "Kalium", value: 3120, unit: "mg", reference: 4000 },
  { name: "Zink", value: 9.8, unit: "mg", reference: 7 },
  { name: "Selen", value: 48, unit: "µg", reference: 60 },
  { name: "Iod", value: 112, unit: "µg", reference: 200 },
  { name: "Vitamin C", value: 128, unit: "mg", reference: 95 },
  { name: "Vitamin D", value: 3.1, unit: "µg", reference: 20 },
  { name: "Vitamin B12", value: 2.9, unit: "µg", reference: 4 },
  { name: "Folat", value: 289, unit: "µg", reference: 300 },
  { name: "Vitamin E", value: 14.6, unit: "mg", reference: 12 },
  { name: "Omega-3-Fettsäuren", value: null, unit: "g", reference: null },
];

/** Weight, with the seven-day mean the progress page draws through it. */
export const weightSeries = [
  { day: "07.08.", kg: 78.4 }, { day: "11.08.", kg: 78.1 }, { day: "14.08.", kg: 77.9 },
  { day: "18.08.", kg: 77.4 }, { day: "21.08.", kg: 77.6 }, { day: "25.08.", kg: 77.0 },
  { day: "28.08.", kg: 76.8 }, { day: "01.09.", kg: 76.5 }, { day: "04.09.", kg: 76.2 },
];

export const energySeries = [2380, 2210, 2455, 1980, 2340, 2610, 2120, 1884];

/**
 * The review queue. Every row is a proposal, which is what the AI pipeline
 * actually produces: candidates with a resolved food, a weight and a
 * confidence, waiting for a person. One component deliberately resolves to
 * nothing, because that is the case the real screen has to show.
 */
export const proposals = [
  {
    title: "Foto — Mittagessen",
    meta: "qwen3.5:4b · 2,8 s · Konfidenz mittel",
    components: [
      { name: "Reis, gekocht", resolved: "Reis, poliert, gegart", source: "BLS", grams: 210 },
      { name: "Hähnchenbrust", resolved: "Hähnchenbrustfilet, gegart", source: "BLS", grams: 150 },
      { name: "Sojasauce", resolved: "Sojasauce", source: "USDA", grams: 12 },
      { name: "Frühlingszwiebel", resolved: null, source: null, grams: null },
    ],
  },
  {
    title: "URL — chefkoch.de/rezepte/…",
    meta: "Rezeptimport · 9 Zutaten · Konfidenz hoch",
    components: [
      { name: "Mehl Type 405", resolved: "Weizenmehl Type 405", source: "BLS", grams: 500 },
      { name: "2 EL Olivenöl", resolved: "Olivenöl", source: "USDA", grams: 20 },
      { name: "1 Würfel Hefe", resolved: "Hefe, frisch", source: "BLS", grams: 42 },
    ],
  },
];

/**
 * What the search field looks through. `completeness` is the share of the
 * primary nutrients the record actually carries - the same figure the real
 * stop rule reads - so the demo can show why a tier was left early or not.
 */
export const searchIndex = [
  { name: "Haferflocken, Vollkorn", code: "C-1-2-0", source: "BLS", kcal: 379, completeness: 1 },
  { name: "Haferdrink, ungesüßt", brand: "Oatly", source: "OFF", kcal: 46, completeness: 0.75 },
  { name: "Hafergrütze", code: "C-1-2-1", source: "BLS", kcal: 371, completeness: 1 },
  { name: "Linsen, rot, gekocht", code: "C-0-1-2", source: "BLS", kcal: 116, completeness: 1 },
  { name: "Linsen, getrocknet", code: "C-0-1-0", source: "BLS", kcal: 304, completeness: 1 },
  { name: "Lentils, raw", code: "16069", source: "USDA", kcal: 352, completeness: 1 },
  { name: "Vollkornbrot", brand: "Harry", source: "OFF", kcal: 219, completeness: 0.75, estimated: true },
  { name: "Roggenvollkornbrot", code: "B-1-1-2", source: "BLS", kcal: 193, completeness: 1 },
  { name: "Weizenmehl Type 405", code: "B-0-1-0", source: "BLS", kcal: 344, completeness: 1 },
  { name: "Milch, 1,5 % Fett", code: "M-1-1-2", source: "BLS", kcal: 47, completeness: 1 },
  { name: "Skyr, natur", brand: "Arla", source: "OFF", kcal: 64, completeness: 0.75 },
  { name: "Quark, Magerstufe", code: "M-3-1-0", source: "BLS", kcal: 71, completeness: 1 },
  { name: "Hähnchenbrustfilet, gegart", code: "F-1-1-2", source: "BLS", kcal: 165, completeness: 1 },
  { name: "Lachs, gegart", code: "175168", source: "USDA", kcal: 209, completeness: 1 },
  { name: "Ei, gekocht", code: "E-1-1-1", source: "BLS", kcal: 155, completeness: 1 },
  { name: "Olivenöl, nativ extra", code: "171413", source: "USDA", kcal: 884, completeness: 1 },
  { name: "Butter, mittelgesalzen", code: "173430", source: "USDA", kcal: 717, completeness: 1 },
  { name: "Walnusskerne", code: "N-2-1-0", source: "BLS", kcal: 692, completeness: 1 },
  { name: "Mandeln, ungeschält", code: "170567", source: "USDA", kcal: 579, completeness: 1 },
  { name: "Brokkoli, gedünstet", code: "G-2-1-3", source: "BLS", kcal: 34, completeness: 1 },
  { name: "Kartoffeln, gekocht", code: "G-4-1-2", source: "BLS", kcal: 70, completeness: 1 },
  { name: "Apfel, roh", code: "O-1-1-0", source: "BLS", kcal: 53, completeness: 1 },
  { name: "Heidelbeeren, roh", code: "171711", source: "USDA", kcal: 57, completeness: 1 },
  { name: "Ofengemüse mit Feta", source: "RECIPE", kcal: 121, completeness: 1 },
  { name: "Nuss-Nougat-Creme", brand: "Nutella", source: "OFF", kcal: 539, completeness: 0.75 },
];
