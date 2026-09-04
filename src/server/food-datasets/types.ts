import type { BasisUnit, FoodType, Locale } from "@prisma/client";

/**
 * The food types an external source can describe.
 *
 * RECIPE is excluded on purpose: it means "computed from a NutriCore recipe",
 * which no food database can be the origin of.
 */
export type ProviderFoodType = Exclude<FoodType, "RECIPE">;

/**
 * Why a nutrient carries no number, or what kind of number it carries, when
 * the source says more than "unknown".
 *
 * A food database that only distinguished "value" from "no value" would be
 * lying about its own data: BLS 4.0 separates a nutrient that was never
 * determined from one measured below the detection limit and from one that is
 * zero by definition (there is no alcohol in oats). All three read as an empty
 * cell to a naive importer, and the third one is a real zero.
 */
export type NutrientQualifier =
  /** Present, but below the limit of quantification: "Spuren"/"TR". */
  | "TRACE"
  | "BELOW_LOD"
  | "BELOW_LOQ"
  | "BELOW_LOD_OR_LOQ"
  /** Genuinely zero, because the food cannot contain it: BLS "Logische Null". */
  | "LOGICAL_ZERO";

export interface ImportableNutrient {
  /** In the canonical unit. NULL means unknown - never zero. */
  value: number | null;
  /** The number exactly as the source published it, before conversion. */
  sourceValue: number | null;
  sourceUnit: string | null;
  qualifier: NutrientQualifier | null;
  /** The source's own word for how it obtained the value. */
  origin: string | null;
}

export interface ImportableServing {
  label: string;
  amount: number;
  unit: string;
  gramEquivalent: number | null;
  mlEquivalent: number | null;
  isDefault: boolean;
}

/**
 * One food from a bundled reference database, already mapped onto NutriCore's
 * model but not yet written. Keeping this in between the dataset readers and
 * the database means the mapping is unit-testable against real records without
 * a database, and the writer has one shape to deal with for every source.
 */
export interface ImportableFood {
  /** The source's own identifier, preserved: a BLS code, an FDC id. */
  externalId: string;
  /** The source's primary name, in `locale`. */
  name: string;
  locale: Locale;
  /** Official names in other languages. Never machine-translated. */
  translations: { locale: Locale; name: string }[];
  aliases: { locale: Locale; name: string }[];
  foodType: ProviderFoodType;
  rawState: string | null;
  basisAmount: number;
  basisUnit: BasisUnit;
  servings: ImportableServing[];
  nutrients: Record<string, ImportableNutrient>;
  /** Kept on FoodSource.metadata so the original record stays traceable. */
  metadata: Record<string, unknown>;
}

/** What one dataset reader has to offer the importer. */
export interface DatasetDefinition {
  /** Manifest key: `bls`, `usda-foundation`, `usda-sr-legacy`. */
  key: string
  /** Stable provider identity, paired with `externalId` to find a row again. */
  provider: string;
  sourceType: "BLS" | "USDA";
  /** Attribution URL for the food's FoodSource row. */
  url: (externalId: string) => string | null;
  /** How much to trust the source, stored as the food's data confidence. */
  confidence: number;
}

export interface MappingIssue {
  externalId: string;
  detail: string;
}

export interface DatasetMapResult {
  foods: ImportableFood[];
  /** Records the reader refused to map, and why. Reported, never swallowed. */
  issues: MappingIssue[];
  /** Source fields no canonical nutrient key claims, with how often they occur. */
  unmapped: Record<string, number>;
}
