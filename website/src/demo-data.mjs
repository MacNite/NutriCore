/**
 * The demo fixture.
 *
 * Static on purpose: the demo has no server, no database and no storage, so
 * what it shows has to be a fixture rather than a session. The shape is the
 * shape the real screens receive - a day is meals of entries, an entry carries
 * the source its numbers came from, a nutrient the day's foods never stated is
 * null rather than zero - because the page renders the application's own
 * components against it.
 *
 * The foods are real reference entries: BLS names and USDA identifiers are the
 * genuine ones, so nothing here invents a record that does not exist upstream.
 * The German names are what a German food database actually carries; the
 * application translates its interface, never its food data.
 */

export const profile = {
  name: "Anna Reuter",
  initials: "AR",
  /** Mirrors `getCurrentTarget`: the target before the day's activity is added. */
  target: { kcal: 2404, protein: 150, carbohydrate: 240, fat: 80 },
  basis: "Mifflin-St Jeor · MODERATE ×1.55 · LOSE −400",
  /** `mealSplit` in the profile: whole percents of the day, totalling 100. */
  mealSplit: { BREAKFAST: 25, LUNCH: 35, DINNER: 30, SNACKS: 10 },
};

/** The four meals, in the order `MEALS` lists them in src/server/diary.ts. */
export const MEALS = ["BREAKFAST", "LUNCH", "DINNER", "SNACKS"];

export const days = [
  {
    date: "2026-09-04",
    weekday: "Thu, 4 September",
    label: "Thursday, 4 September",
    activity: {
      totalActiveKcal: 320,
      entries: [
        { name: "Cycling", detail: "moderate · 45 min", activeKcal: 236 },
        { name: "Walking", detail: "easy · 30 min", activeKcal: 84 },
      ],
    },
    meals: {
      BREAKFAST: [
        { name: "Haferflocken, Vollkorn", quantity: 80, unit: "g", source: "BLS", kcal: 303, protein: 11, carbohydrate: 47, fat: 6 },
        { name: "Milch, 1,5 % Fett", quantity: 200, unit: "ml", source: "BLS", kcal: 94, protein: 7, carbohydrate: 10, fat: 3 },
        { name: "Blueberries, raw", quantity: 100, unit: "g", source: "USDA", kcal: 57, protein: 1, carbohydrate: 14, fat: 0 },
      ],
      LUNCH: [
        { name: "Linsen, rot, gekocht", quantity: 180, unit: "g", source: "BLS", kcal: 208, protein: 15, carbohydrate: 32, fat: 1 },
        { name: "Olive oil, extra virgin", quantity: 12, unit: "g", source: "USDA", kcal: 106, protein: 0, carbohydrate: 0, fat: 12 },
        { name: "Vollkornbrot", brand: "Harry", quantity: 90, unit: "g", source: "OPEN_FOOD_FACTS", kcal: 328, protein: 11, carbohydrate: 55, fat: 4 },
      ],
      DINNER: [
        { name: "Ofengemüse mit Feta", quantity: 1, unit: "serving", source: "RECIPE", kcal: 486, protein: 19, carbohydrate: 34, fat: 29 },
        { name: "Hähnchenbrustfilet, gegart", quantity: 150, unit: "g", source: "BLS", kcal: 248, protein: 47, carbohydrate: 0, fat: 6 },
      ],
      SNACKS: [
        { name: "Skyr, natur", brand: "Arla", quantity: 150, unit: "g", source: "OPEN_FOOD_FACTS", kcal: 96, protein: 17, carbohydrate: 6, fat: 0 },
        { name: "Walnusskerne", quantity: 20, unit: "g", source: "BLS", kcal: 138, protein: 3, carbohydrate: 2, fat: 14 },
      ],
    },
    /**
     * `value` is the day's sum for that nutrient, `coverage` the share of the
     * day's food weight that stated it at all. A food that omits a nutrient -
     * the BLS does this for values it never determined - lowers the coverage
     * instead of pulling the sum towards zero.
     */
    micronutrients: {
      calcium: { value: 861, coverage: 0.82 },
      iron: { value: 14.2, coverage: 1 },
      magnesium: { value: 412, coverage: 1 },
      phosphorus: { value: 1420, coverage: 0.86 },
      potassium: { value: 3120, coverage: 1 },
      zinc: { value: 9.8, coverage: 0.94 },
      copper: { value: 1.6, coverage: 0.74 },
      manganese: { value: 4.2, coverage: 0.74 },
      selenium: { value: 48, coverage: 0.68 },
      iodine: { value: 112, coverage: 0.61 },
      vitaminA: { value: 640, coverage: 0.86 },
      vitaminC: { value: 128, coverage: 0.71 },
      vitaminD: { value: 3.1, coverage: 0.74 },
      vitaminE: { value: 14.6, coverage: 0.86 },
      vitaminK: { value: 96, coverage: 0.62 },
      thiamin: { value: 1.4, coverage: 0.94 },
      riboflavin: { value: 1.7, coverage: 0.94 },
      niacin: { value: 24.1, coverage: 0.94 },
      pantothenicAcid: { value: 5.1, coverage: 0.68 },
      vitaminB6: { value: 2.1, coverage: 0.94 },
      folate: { value: 289, coverage: 0.86 },
      vitaminB12: { value: 2.9, coverage: 0.94 },
    },
  },
  {
    date: "2026-09-03",
    weekday: "Wed, 3 September",
    label: "Wednesday, 3 September",
    activity: { totalActiveKcal: null, entries: [] },
    meals: {
      BREAKFAST: [
        { name: "Roggenvollkornbrot", quantity: 100, unit: "g", source: "BLS", kcal: 193, protein: 7, carbohydrate: 36, fat: 1 },
        { name: "Frischkäse, 20 % F.i.Tr.", quantity: 30, unit: "g", source: "BLS", kcal: 42, protein: 4, carbohydrate: 1, fat: 3 },
        { name: "Ei, gekocht", quantity: 110, unit: "g", source: "BLS", kcal: 171, protein: 14, carbohydrate: 1, fat: 12 },
      ],
      LUNCH: [
        { name: "Salmon, cooked", quantity: 140, unit: "g", source: "USDA", kcal: 293, protein: 35, carbohydrate: 0, fat: 17 },
        { name: "Kartoffeln, gekocht", quantity: 250, unit: "g", source: "BLS", kcal: 175, protein: 5, carbohydrate: 38, fat: 0 },
        { name: "Brokkoli, gedünstet", quantity: 200, unit: "g", source: "BLS", kcal: 68, protein: 6, carbohydrate: 8, fat: 1 },
      ],
      DINNER: [
        { name: "Linsensalat mit Feta", quantity: 1, unit: "serving", source: "RECIPE", kcal: 512, protein: 24, carbohydrate: 44, fat: 24 },
      ],
      SNACKS: [
        { name: "Apfel, roh", quantity: 180, unit: "g", source: "BLS", kcal: 95, protein: 0, carbohydrate: 22, fat: 0 },
        { name: "Almonds", quantity: 25, unit: "g", source: "USDA", kcal: 145, protein: 5, carbohydrate: 5, fat: 13 },
        { name: "Zartbitterschokolade, 70 %", brand: "Lindt", quantity: 30, unit: "g", source: "OPEN_FOOD_FACTS", kcal: 176, protein: 2, carbohydrate: 11, fat: 13 },
      ],
    },
    micronutrients: {
      calcium: { value: 742, coverage: 0.88 },
      iron: { value: 11.6, coverage: 1 },
      magnesium: { value: 386, coverage: 1 },
      phosphorus: { value: 1310, coverage: 0.9 },
      potassium: { value: 3480, coverage: 1 },
      zinc: { value: 8.4, coverage: 0.9 },
      copper: { value: 1.3, coverage: 0.7 },
      manganese: { value: 2.8, coverage: 0.7 },
      selenium: { value: 71, coverage: 0.74 },
      iodine: { value: 96, coverage: 0.58 },
      vitaminA: { value: 512, coverage: 0.9 },
      vitaminC: { value: 164, coverage: 0.79 },
      vitaminD: { value: 12.4, coverage: 0.79 },
      vitaminE: { value: 11.2, coverage: 0.9 },
      vitaminK: { value: 182, coverage: 0.66 },
      thiamin: { value: 1.1, coverage: 0.9 },
      riboflavin: { value: 1.5, coverage: 0.9 },
      niacin: { value: 21.4, coverage: 0.9 },
      pantothenicAcid: { value: 4.4, coverage: 0.7 },
      vitaminB6: { value: 2.6, coverage: 0.9 },
      folate: { value: 244, coverage: 0.9 },
      vitaminB12: { value: 6.2, coverage: 0.9 },
    },
  },
];

/**
 * Foods logged before, in the order the diary last used them - what
 * `recentFoods` returns, portion included.
 */
export const recentFoods = [
  { name: "Skyr, natur", brand: "Arla", quantity: 150, unit: "g", source: "OPEN_FOOD_FACTS" },
  { name: "Haferflocken, Vollkorn", quantity: 80, unit: "g", source: "BLS" },
  { name: "Hähnchenbrustfilet, gegart", quantity: 150, unit: "g", source: "BLS" },
  { name: "Blueberries, raw", quantity: 100, unit: "g", source: "USDA" },
  { name: "Walnusskerne", quantity: 20, unit: "g", source: "BLS" },
];

/**
 * What the food search looks through. Energy is per 100 g or 100 ml, the basis
 * the application shows next to every result.
 */
export const searchIndex = [
  { name: "Haferflocken, Vollkorn", source: "BLS", kcal: 379, basis: 100, basisUnit: "g" },
  { name: "Haferdrink, ungesüßt", brand: "Oatly", source: "OPEN_FOOD_FACTS", kcal: 46, basis: 100, basisUnit: "ml" },
  { name: "Hafergrütze", source: "BLS", kcal: 371, basis: 100, basisUnit: "g" },
  { name: "Linsen, rot, gekocht", source: "BLS", kcal: 116, basis: 100, basisUnit: "g" },
  { name: "Linsen, getrocknet", source: "BLS", kcal: 304, basis: 100, basisUnit: "g" },
  { name: "Lentils, raw", source: "USDA", kcal: 352, basis: 100, basisUnit: "g" },
  { name: "Vollkornbrot", brand: "Harry", source: "OPEN_FOOD_FACTS", kcal: 219, basis: 100, basisUnit: "g" },
  { name: "Roggenvollkornbrot", source: "BLS", kcal: 193, basis: 100, basisUnit: "g" },
  { name: "Weizenmehl Type 405", source: "BLS", kcal: 344, basis: 100, basisUnit: "g" },
  { name: "Milch, 1,5 % Fett", source: "BLS", kcal: 47, basis: 100, basisUnit: "ml" },
  { name: "Skyr, natur", brand: "Arla", source: "OPEN_FOOD_FACTS", kcal: 64, basis: 100, basisUnit: "g" },
  { name: "Quark, Magerstufe", source: "BLS", kcal: 71, basis: 100, basisUnit: "g" },
  { name: "Hähnchenbrustfilet, gegart", source: "BLS", kcal: 165, basis: 100, basisUnit: "g" },
  { name: "Salmon, cooked", source: "USDA", kcal: 209, basis: 100, basisUnit: "g" },
  { name: "Ei, gekocht", source: "BLS", kcal: 155, basis: 100, basisUnit: "g" },
  { name: "Olive oil, extra virgin", source: "USDA", kcal: 884, basis: 100, basisUnit: "g" },
  { name: "Butter, salted", source: "USDA", kcal: 717, basis: 100, basisUnit: "g" },
  { name: "Walnusskerne", source: "BLS", kcal: 692, basis: 100, basisUnit: "g" },
  { name: "Almonds", source: "USDA", kcal: 579, basis: 100, basisUnit: "g" },
  { name: "Brokkoli, gedünstet", source: "BLS", kcal: 34, basis: 100, basisUnit: "g" },
  { name: "Kartoffeln, gekocht", source: "BLS", kcal: 70, basis: 100, basisUnit: "g" },
  { name: "Apfel, roh", source: "BLS", kcal: 53, basis: 100, basisUnit: "g" },
  { name: "Blueberries, raw", source: "USDA", kcal: 57, basis: 100, basisUnit: "g" },
  { name: "Ofengemüse mit Feta", source: "RECIPE", kcal: 121, basis: 100, basisUnit: "g" },
  { name: "Linsensalat mit Feta", source: "RECIPE", kcal: 138, basis: 100, basisUnit: "g" },
  { name: "Nuss-Nougat-Creme", brand: "Nutella", source: "OPEN_FOOD_FACTS", kcal: 539, basis: 100, basisUnit: "g" },
];

/** The reader's own recipes, as the foods screen lists them. */
export const recipes = [
  { name: "Ofengemüse mit Feta", ingredients: 6 },
  { name: "Linsensalat mit Feta", ingredients: 8 },
];

/**
 * Proposals waiting for a decision. This is what the AI pipeline produces:
 * components resolved against the food database, with everything it could not
 * resolve named as skipped - never guessed, and never logged.
 */
export const proposals = [
  {
    text: "Photo · lunch",
    summary: "Reis, poliert, gegart 210 g · Hähnchenbrustfilet, gegart 150 g · Sojasauce 12 g",
    skipped: ["Frühlingszwiebel"],
  },
  {
    text: "chefkoch.de/rezepte/… · recipe import",
    summary: "Weizenmehl Type 405 500 g · Olive oil, extra virgin 20 g · Hefe, frisch 42 g",
    skipped: [],
  },
];

/** Weight, measured every few days over the month the progress screen draws. */
export const weightSeries = [
  { date: "2026-08-07", kg: 78.4 },
  { date: "2026-08-11", kg: 78.1 },
  { date: "2026-08-14", kg: 77.9 },
  { date: "2026-08-18", kg: 77.4 },
  { date: "2026-08-21", kg: 77.6 },
  { date: "2026-08-25", kg: 77.0 },
  { date: "2026-08-28", kg: 76.8 },
  { date: "2026-09-01", kg: 76.5 },
  { date: "2026-09-04", kg: 76.2 },
];

/** Energy logged per day. The last two days are the diaries above, summed. */
export const energySeries = [
  { date: "2026-08-21", kcal: 2520 },
  { date: "2026-08-22", kcal: 2295 },
  { date: "2026-08-23", kcal: 2710 },
  { date: "2026-08-24", kcal: 2140 },
  { date: "2026-08-25", kcal: 2060 },
  { date: "2026-08-26", kcal: 2430 },
  { date: "2026-08-27", kcal: 2185 },
  { date: "2026-08-28", kcal: 2380 },
  { date: "2026-08-29", kcal: 2210 },
  { date: "2026-08-30", kcal: 2455 },
  { date: "2026-08-31", kcal: 1980 },
  { date: "2026-09-01", kcal: 2340 },
  { date: "2026-09-02", kcal: 2610 },
  { date: "2026-09-03", kcal: 1870 },
  { date: "2026-09-04", kcal: 2064 },
];
