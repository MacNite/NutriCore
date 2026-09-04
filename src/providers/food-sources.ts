/**
 * The food source registry: which sources exist, what each is for, and in what
 * order they are consulted.
 *
 * This file is the answer to "where does a search actually look?". Every
 * ordering decision lives here rather than in `searchFoods`, in a React
 * component or in a ranking weight, so the tier model can be read in one place
 * and tested without a database.
 *
 * Tier order and ranking are different things and are deliberately kept apart:
 *
 *   Tier order decides which source is *asked*.
 *   Ranking (src/lib/ranking.ts) decides how the answers are *ordered*.
 *
 * A source with slightly higher trust must never be asked first if a cheaper,
 * closer source can answer, and a source being asked first must never let a
 * poor result from it outrank a good one from further down.
 */
import type { Locale } from "@/i18n/locales";
import { flag, hasSecret } from "@/lib/env";
import type { PersistencePolicy, ProviderCachePolicy } from "./food";

export type FoodSourceId = "LOCAL" | "BLS" | "USDA" | "OPEN_FOOD_FACTS" | "FATSECRET";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface FoodSourceDescriptor {
  id: FoodSourceId;
  /**
   * Whether the source can answer from NutriCore's own tables, and which
   * `SourceType` rows belong to it. A bundled database (BLS, the imported USDA
   * downloads) answers locally and needs no network at all.
   */
  stored: { sourceTypes: string[] } | { rest: true } | null;
  /** Whether the source can also be asked over the network. */
  network: boolean;
  capabilities: { textSearch: boolean; barcode: boolean };
  cache: ProviderCachePolicy;
  /** Reads configuration on every call, so a test can change it. */
  isEnabled: () => boolean;
  /** True when the network half is configured; a stored half may still work. */
  isNetworkConfigured: () => boolean;
}

/** The sources whose rows are *not* the generic "local" tier. */
export const BUNDLED_SOURCE_TYPES = ["BLS", "USDA"];

const permanent: PersistencePolicy = "PERMANENT";

export const FOOD_SOURCES: Record<FoodSourceId, FoodSourceDescriptor> = {
  /**
   * Everything NutriCore already holds that is not a bundled reference
   * database: the user's own foods, their recipes exposed as foods, and the
   * public provider foods a previous lookup stored or cached.
   */
  LOCAL: {
    id: "LOCAL",
    stored: { rest: true },
    network: false,
    capabilities: { textSearch: true, barcode: true },
    cache: { searchTtlMs: 0, contentTtlMs: 0, persistence: permanent, serveStaleOnOutage: true },
    isEnabled: () => true,
    isNetworkConfigured: () => false,
  },

  /**
   * Bundeslebensmittelschlüssel 4.0: the authoritative German generic-food
   * database, imported into PostgreSQL and therefore free to consult on every
   * keystroke. Enabled by default because it ships with the application.
   */
  BLS: {
    id: "BLS",
    stored: { sourceTypes: ["BLS"] },
    network: false,
    capabilities: { textSearch: true, barcode: false },
    cache: { searchTtlMs: 0, contentTtlMs: 0, persistence: permanent, serveStaleOnOutage: true },
    isEnabled: () => flag("BLS_ENABLED", true),
    isNetworkConfigured: () => false,
  },

  /**
   * USDA FoodData Central, in two halves that share one provider identity:
   * the bundled Foundation Foods and SR Legacy downloads, which answer
   * locally, and the FoodData Central API, which needs a key and is therefore
   * only consulted when remote lookups are permitted.
   */
  USDA: {
    id: "USDA",
    stored: { sourceTypes: ["USDA"] },
    network: true,
    capabilities: { textSearch: true, barcode: false },
    cache: {
      searchTtlMs: 7 * DAY,
      // FDC publishes a release a few times a year and never rewrites a record
      // in place, so a stored food stays correct for a long time.
      contentTtlMs: 30 * DAY,
      persistence: permanent,
      serveStaleOnOutage: true,
    },
    isEnabled: () => flag("USDA_ENABLED", true),
    isNetworkConfigured: () => flag("USDA_ENABLED", true) && hasSecret("USDA_API_KEY"),
  },

  /** Open Food Facts: branded and packaged products, and every barcode. */
  OPEN_FOOD_FACTS: {
    id: "OPEN_FOOD_FACTS",
    stored: null,
    network: true,
    capabilities: { textSearch: true, barcode: true },
    cache: {
      searchTtlMs: DAY,
      contentTtlMs: 7 * DAY,
      // The Open Database Licence permits keeping the data; NutriCore's About
      // page carries the attribution and the share-alike note.
      persistence: permanent,
      serveStaleOnOutage: true,
    },
    isEnabled: () => flag("OPENFOODFACTS_ENABLED", true),
    isNetworkConfigured: () => flag("OPENFOODFACTS_ENABLED", true),
  },

  /**
   * FatSecret: an optional verified fallback, never a foundation.
   *
   * Its content is cached rather than kept: the Platform API terms allow using
   * the data, not accumulating a copy of the database. So a FatSecret food
   * expires, is pruned once nothing references it, and is never served from an
   * expired cache during an outage.
   */
  FATSECRET: {
    id: "FATSECRET",
    stored: null,
    network: true,
    capabilities: { textSearch: true, barcode: true },
    cache: {
      searchTtlMs: HOUR,
      contentTtlMs: DAY,
      persistence: "CACHE_WITH_TTL",
      serveStaleOnOutage: false,
    },
    isEnabled: () => flag("FATSECRET_ENABLED", false),
    isNetworkConfigured: () =>
      flag("FATSECRET_ENABLED", false) && hasSecret("FATSECRET_CLIENT_ID") && hasSecret("FATSECRET_CLIENT_SECRET"),
  },
};

/**
 * Text-search order per locale.
 *
 * German goes to BLS before the internet: it is the national reference
 * database, it is already on disk, and for a generic German food it is a
 * better answer than a crowd-sourced product entry. English has no bundled
 * German equivalent, so USDA FoodData Central takes that place.
 *
 * A new locale is a new entry here and nothing else - which is the point of
 * keeping the map in one place rather than testing the language wherever a
 * source is used.
 */
export const TEXT_SEARCH_ORDER: Record<Locale, FoodSourceId[]> = {
  de: ["LOCAL", "BLS", "OPEN_FOOD_FACTS", "FATSECRET", "USDA"],
  en: ["LOCAL", "USDA", "OPEN_FOOD_FACTS", "FATSECRET"],
};

/**
 * Barcode order, which is locale-independent.
 *
 * A barcode identifies one packaged product, and a generic ingredient database
 * cannot possibly hold it: asking BLS or the USDA generic datasets for an EAN
 * is a guaranteed miss and would only add latency. Open Food Facts is the
 * product database, and FatSecret is asked afterwards only if its configured
 * plan supports barcode lookup at all.
 */
export const BARCODE_ORDER: FoodSourceId[] = ["LOCAL", "OPEN_FOOD_FACTS", "FATSECRET"];

/** The locale's order, falling back to the German one for an unknown locale. */
export const textSearchOrder = (locale: Locale): FoodSourceId[] => TEXT_SEARCH_ORDER[locale] ?? TEXT_SEARCH_ORDER.de;

export const sourceById = (id: FoodSourceId): FoodSourceDescriptor => FOOD_SOURCES[id];

/** Only the enabled sources, in tier order. */
export function textSearchTiers(locale: Locale): FoodSourceDescriptor[] {
  return textSearchOrder(locale)
    .map(sourceById)
    .filter((source) => source.isEnabled() && source.capabilities.textSearch);
}

export function barcodeTiers(): FoodSourceDescriptor[] {
  return BARCODE_ORDER.map(sourceById).filter((source) => source.isEnabled() && source.capabilities.barcode);
}

/** True when this source answers without touching the network at all. */
export const hasStoredTier = (source: FoodSourceDescriptor) => source.stored !== null;

/** The expiry to stamp on a food from this source, or null when permanent. */
export function cacheExpiryFor(source: FoodSourceDescriptor, now = Date.now()): Date | null {
  if (source.cache.persistence === "PERMANENT") return null;
  return new Date(now + source.cache.contentTtlMs);
}
