/**
 * Canonical nutrient catalogue. Adding a nutrient means adding a row here and
 * re-running the seed - it never requires a schema migration.
 */
export interface NutrientDef {
  key: string;
  nameDe: string;
  nameEn: string;
  unit: string;
  category: "energy" | "macro" | "secondary" | "mineral" | "vitamin";
  sortOrder: number;
}

export const NUTRIENTS: NutrientDef[] = [
  { key: "energyKcal", nameDe: "Energie", nameEn: "Energy", unit: "kcal", category: "energy", sortOrder: 10 },
  { key: "energyKj", nameDe: "Energie", nameEn: "Energy", unit: "kJ", category: "energy", sortOrder: 20 },
  { key: "protein", nameDe: "Protein", nameEn: "Protein", unit: "g", category: "macro", sortOrder: 30 },
  { key: "carbohydrate", nameDe: "Kohlenhydrate", nameEn: "Carbohydrates", unit: "g", category: "macro", sortOrder: 40 },
  { key: "fat", nameDe: "Fett", nameEn: "Fat", unit: "g", category: "macro", sortOrder: 50 },
  { key: "saturatedFat", nameDe: "gesättigte Fettsäuren", nameEn: "Saturated fat", unit: "g", category: "secondary", sortOrder: 60 },
  { key: "transFat", nameDe: "trans-Fettsäuren", nameEn: "Trans fat", unit: "g", category: "secondary", sortOrder: 65 },
  { key: "monounsaturatedFat", nameDe: "einfach ungesättigte Fettsäuren", nameEn: "Monounsaturated fat", unit: "g", category: "secondary", sortOrder: 70 },
  { key: "polyunsaturatedFat", nameDe: "mehrfach ungesättigte Fettsäuren", nameEn: "Polyunsaturated fat", unit: "g", category: "secondary", sortOrder: 80 },
  { key: "omega3", nameDe: "Omega-3-Fettsäuren", nameEn: "Omega-3 fatty acids", unit: "g", category: "secondary", sortOrder: 82 },
  { key: "omega6", nameDe: "Omega-6-Fettsäuren", nameEn: "Omega-6 fatty acids", unit: "g", category: "secondary", sortOrder: 84 },
  { key: "sugar", nameDe: "Zucker", nameEn: "Sugar", unit: "g", category: "secondary", sortOrder: 90 },
  { key: "starch", nameDe: "Stärke", nameEn: "Starch", unit: "g", category: "secondary", sortOrder: 95 },
  { key: "polyols", nameDe: "Zuckeralkohole", nameEn: "Polyols", unit: "g", category: "secondary", sortOrder: 96 },
  { key: "fiber", nameDe: "Ballaststoffe", nameEn: "Fibre", unit: "g", category: "secondary", sortOrder: 100 },
  { key: "water", nameDe: "Wasser", nameEn: "Water", unit: "g", category: "secondary", sortOrder: 105 },
  { key: "sodium", nameDe: "Natrium", nameEn: "Sodium", unit: "g", category: "secondary", sortOrder: 110 },
  { key: "salt", nameDe: "Salz", nameEn: "Salt", unit: "g", category: "secondary", sortOrder: 120 },
  { key: "alcohol", nameDe: "Alkohol", nameEn: "Alcohol", unit: "g", category: "secondary", sortOrder: 125 },
  { key: "cholesterol", nameDe: "Cholesterin", nameEn: "Cholesterol", unit: "mg", category: "secondary", sortOrder: 130 },
  { key: "calcium", nameDe: "Calcium", nameEn: "Calcium", unit: "mg", category: "mineral", sortOrder: 200 },
  { key: "iron", nameDe: "Eisen", nameEn: "Iron", unit: "mg", category: "mineral", sortOrder: 210 },
  { key: "magnesium", nameDe: "Magnesium", nameEn: "Magnesium", unit: "mg", category: "mineral", sortOrder: 220 },
  { key: "phosphorus", nameDe: "Phosphor", nameEn: "Phosphorus", unit: "mg", category: "mineral", sortOrder: 230 },
  { key: "potassium", nameDe: "Kalium", nameEn: "Potassium", unit: "mg", category: "mineral", sortOrder: 240 },
  { key: "chloride", nameDe: "Chlorid", nameEn: "Chloride", unit: "mg", category: "mineral", sortOrder: 245 },
  { key: "zinc", nameDe: "Zink", nameEn: "Zinc", unit: "mg", category: "mineral", sortOrder: 250 },
  { key: "copper", nameDe: "Kupfer", nameEn: "Copper", unit: "mg", category: "mineral", sortOrder: 260 },
  { key: "manganese", nameDe: "Mangan", nameEn: "Manganese", unit: "mg", category: "mineral", sortOrder: 270 },
  { key: "selenium", nameDe: "Selen", nameEn: "Selenium", unit: "µg", category: "mineral", sortOrder: 280 },
  { key: "iodine", nameDe: "Iod", nameEn: "Iodine", unit: "µg", category: "mineral", sortOrder: 285 },
  { key: "fluoride", nameDe: "Fluorid", nameEn: "Fluoride", unit: "µg", category: "mineral", sortOrder: 290 },
  { key: "chromium", nameDe: "Chrom", nameEn: "Chromium", unit: "µg", category: "mineral", sortOrder: 292 },
  { key: "molybdenum", nameDe: "Molybdän", nameEn: "Molybdenum", unit: "µg", category: "mineral", sortOrder: 294 },
  { key: "vitaminA", nameDe: "Vitamin A", nameEn: "Vitamin A", unit: "µg", category: "vitamin", sortOrder: 300 },
  { key: "vitaminC", nameDe: "Vitamin C", nameEn: "Vitamin C", unit: "mg", category: "vitamin", sortOrder: 310 },
  { key: "vitaminD", nameDe: "Vitamin D", nameEn: "Vitamin D", unit: "µg", category: "vitamin", sortOrder: 320 },
  { key: "vitaminE", nameDe: "Vitamin E", nameEn: "Vitamin E", unit: "mg", category: "vitamin", sortOrder: 330 },
  { key: "vitaminK", nameDe: "Vitamin K", nameEn: "Vitamin K", unit: "µg", category: "vitamin", sortOrder: 340 },
  { key: "thiamin", nameDe: "Thiamin (B1)", nameEn: "Thiamin (B1)", unit: "mg", category: "vitamin", sortOrder: 350 },
  { key: "riboflavin", nameDe: "Riboflavin (B2)", nameEn: "Riboflavin (B2)", unit: "mg", category: "vitamin", sortOrder: 360 },
  { key: "niacin", nameDe: "Niacin (B3)", nameEn: "Niacin (B3)", unit: "mg", category: "vitamin", sortOrder: 370 },
  { key: "biotin", nameDe: "Biotin (B7)", nameEn: "Biotin (B7)", unit: "µg", category: "vitamin", sortOrder: 375 },
  { key: "pantothenicAcid", nameDe: "Pantothensäure (B5)", nameEn: "Pantothenic acid (B5)", unit: "mg", category: "vitamin", sortOrder: 380 },
  { key: "vitaminB6", nameDe: "Vitamin B6", nameEn: "Vitamin B6", unit: "mg", category: "vitamin", sortOrder: 390 },
  { key: "folate", nameDe: "Folat", nameEn: "Folate", unit: "µg", category: "vitamin", sortOrder: 400 },
  { key: "vitaminB12", nameDe: "Vitamin B12", nameEn: "Vitamin B12", unit: "µg", category: "vitamin", sortOrder: 410 },
];

export const NUTRIENT_BY_KEY = new Map(NUTRIENTS.map((n) => [n.key, n]));
export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);

/** The macros shown on the dashboard and diary summary rows. */
export const PRIMARY_KEYS = ["energyKcal", "protein", "carbohydrate", "fat"] as const;

/** Values users can type into the custom-food form. */
export const EDITABLE_KEYS = NUTRIENTS.filter((n) => n.key !== "energyKj").map((n) => n.key);

export const nutrientUnit = (key: string) => NUTRIENT_BY_KEY.get(key)?.unit ?? "";

/**
 * Whether a food states an energy value the calorie maths can actually use.
 *
 * Open Food Facts carries plenty of products with no energy at all - the value
 * was never entered, or it was lost on the way here - and such a food is worse
 * than useless in a diary: it looks like a normal entry, contributes nothing,
 * and quietly makes the whole meal read low. Those are filtered out of search.
 *
 * A stated zero is *not* the same thing and stays: mineral water really has no
 * calories, and hiding it would be its own bug. Only an absent value counts as
 * missing. kJ is accepted because kcal is derivable from it.
 */
export function hasUsableEnergy(nutrients: Record<string, number | null | undefined> | null | undefined) {
  if (!nutrients) return false;
  const stated = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  return stated(nutrients.energyKcal) || stated(nutrients.energyKj);
}
