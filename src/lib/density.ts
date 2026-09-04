import { normalizeName, type BasisUnit } from "./units";

/**
 * Densities for foods that are sold by volume but weighed in a recipe.
 *
 * A recipe ingredient has to end up with a weight, and turning millilitres into
 * grams needs a density. Open Food Facts never publishes one, so every drink,
 * oil, broth and sauce it supplies arrives with `densityGPerMl` empty - and an
 * ingredient matched to one of those could not be weighed at all. That is not a
 * rare corner: it is most liquids in most recipes.
 *
 * These values are estimates and are marked as such wherever they are used. The
 * food's own stored density always wins; this only fills a hole that would
 * otherwise drop the ingredient. Entries are matched against the food's name in
 * both languages, longest keyword first, so "Rapsöl" is read as an oil rather
 * than falling through to the water-like default.
 */
const DENSITIES: { density: number; keywords: string[] }[] = [
  // Fats float: this is the one common liquid the water-like default gets
  // meaningfully wrong, so it is named in as many spellings as it is sold under.
  { density: 0.92, keywords: ["olivenol", "rapsol", "sonnenblumenol", "sesamol", "leinol", "walnussol", "kokosol", "speiseol", "pflanzenol", "bratol", "salatol", "olive oil", "rapeseed oil", "canola oil", "sunflower oil", "sesame oil", "vegetable oil", "cooking oil", "ol", "oil"] },
  // Sugar syrups are the heavy end, and are occasionally bottled by volume.
  { density: 1.4, keywords: ["honig", "honey", "agavendicksaft", "agave syrup", "ahornsirup", "maple syrup", "zuckerrubensirup", "melasse", "molasses", "sirup", "syrup"] },
  { density: 1.03, keywords: ["kondensmilch", "condensed milk", "buttermilch", "buttermilk", "milch", "milk", "joghurt", "yoghurt", "yogurt", "kefir"] },
  { density: 1.01, keywords: ["sahne", "rahm", "creme fraiche", "schmand", "cream"] },
  { density: 1.01, keywords: ["essig", "vinegar", "sojasauce", "soy sauce", "sojasosse"] },
  { density: 1.04, keywords: ["fruchtsaft", "apfelsaft", "orangensaft", "traubensaft", "multivitaminsaft", "fruit juice", "apple juice", "orange juice", "grape juice", "saft", "juice", "nektar", "nectar", "smoothie"] },
  { density: 0.99, keywords: ["wein", "wine", "sekt", "prosecco", "champagner", "champagne", "bier", "beer", "rum", "wodka", "vodka", "whisky", "whiskey", "likor", "liqueur"] },
  { density: 1.0, keywords: ["bruhe", "fond", "broth", "stock", "bouillon", "wasser", "water", "kaffee", "coffee", "tee", "tea", "cola", "limonade", "lemonade"] },
];

/**
 * Every keyword once, longest first, so a specific match is tried before the
 * generic one it contains ("olivenol" before "ol", "apfelsaft" before "saft").
 */
const LOOKUP = DENSITIES.flatMap((entry) => entry.keywords.map((keyword) => ({ keyword: normalizeName(keyword), density: entry.density })))
  .sort((a, b) => b.keyword.length - a.keyword.length);

/**
 * What a millilitre of an unrecognised liquid is taken to weigh.
 *
 * A food measured in millilitres is a liquid by definition, and nearly every
 * edible liquid other than oil and syrup sits within a few percent of water.
 * Assuming it is the difference between an ingredient the reader can use and an
 * ingredient that silently disappears from their recipe - but it is still an
 * assumption, which is why it is only ever applied to a food whose basis is
 * volume, and never overwrites a density the food actually states.
 */
export const WATER_LIKE_DENSITY = 1;

/**
 * The density to assume for a food sold by volume that stores none, in grams
 * per millilitre. Names are matched on whole words so a brand such as "Ölmühle"
 * cannot be read as an oil.
 */
export function estimatedDensityGPerMl(name: string): number {
  // Compounds are written as one word in German - "Olivenöl", "Apfelsaft" - so
  // a keyword that ends a word counts as a match, which is also what lets the
  // bare "öl" stand in for every oil the list does not name individually.
  const words = normalizeName(name).split(" ").filter(Boolean);
  for (const { keyword, density } of LOOKUP) {
    if (words.some((word) => word === keyword || word.endsWith(keyword))) return density;
  }
  return WATER_LIKE_DENSITY;
}

/**
 * The density to measure one food by, and whether it is the food's own.
 *
 * The single place this decision is made. The recipe save, the AI import and
 * the recipe form's unit dropdown all have to agree about which units a food
 * accepts - a form that refuses a broth the import happily converts is the same
 * disagreement, read from the other end.
 */
export function effectiveDensity(food: { name: string; basisUnit: BasisUnit; densityGPerMl: number | null }) {
  // Only a volume basis. A solid's density is nowhere near water's, and
  // guessing one would put an invented weight into somebody's diary.
  const estimated = food.densityGPerMl === null && food.basisUnit === "ML";
  return {
    densityGPerMl: estimated ? estimatedDensityGPerMl(food.name) : food.densityGPerMl,
    densityEstimated: estimated,
  };
}
