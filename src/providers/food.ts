import { z } from "zod";

export const provenanceSchema = z.object({
  provider: z.string(),
  providerId: z.string().optional(),
  retrievedAt: z.date(),
  providerUpdatedAt: z.date().optional(),
  url: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  estimated: z.boolean().default(false),
});

export const normalizedFoodSchema = z.object({
  externalId: z.string(),
  barcode: z.string().optional(),
  name: z.string(),
  brand: z.string().optional(),
  locale: z.enum(["de", "en"]).optional(),
  basisAmount: z.number().positive(),
  basisUnit: z.enum(["G", "ML"]),
  servingAmount: z.number().positive().optional(),
  servingUnit: z.string().optional(),
  servingLabel: z.string().optional(),
  /**
   * Grams per millilitre, only where the source states it outright. It is never
   * estimated here: an assumed density belongs to the code that converts, not
   * to the record of what the provider said.
   */
  densityGPerMl: z.number().positive().optional(),
  /** null means "unknown". It is never coerced to zero. */
  nutrients: z.record(z.string(), z.number().nullable()),
  /**
   * What kind of food this is, where the source says so. Open Food Facts deals
   * in packaged products and does not need to; a generic ingredient database
   * does, because storing a raw vegetable as PACKAGED would be wrong in the UI
   * and in every filter built on it.
   */
  foodType: z.enum(["PACKAGED", "GENERIC", "RAW", "COOKED", "BEVERAGE"]).optional(),
  /**
   * True when the source carries only part of the nutrient set it could have.
   * A partial product adds to what is already stored and never replaces it,
   * so a search hit cannot erase values a barcode lookup established.
   */
  partial: z.boolean().optional(),
  provenance: provenanceSchema,
  raw: z.unknown().optional(),
});

export type NormalizedFood = z.infer<typeof normalizedFoodSchema>;

export type ProviderFailureReason = "RATE_LIMITED" | "TIMEOUT" | "NETWORK" | "HTTP_ERROR" | "UNAVAILABLE";

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly cause?: unknown,
    public readonly reason: ProviderFailureReason = "UNAVAILABLE",
    public readonly retryAfterSeconds?: number,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export interface FoodProvider {
  readonly name: string;
  readonly enabled: boolean;
  getByBarcode(barcode: string): Promise<NormalizedFood | null>;
  search(query: string, options?: { limit?: number; locale?: string }): Promise<NormalizedFood[]>;
  normalizeProduct(product: Record<string, unknown>): NormalizedFood | null;
}

/**
 * How long a provider's answer may be kept.
 *
 * This is a licensing question before it is a caching question, which is why
 * it belongs to the provider rather than to the code that happens to store the
 * result. Open Food Facts publishes an open database and USDA data is in the
 * public domain, so a food from either may become a permanent local row. The
 * FatSecret Platform API terms do not permit building a copy of their database,
 * so its content is held only as long as it is being used.
 *
 * - `PERMANENT`      - the normalized food may be stored indefinitely.
 * - `CACHE_WITH_TTL` - it may be stored, but expires and is then pruned.
 * - `REFERENCE_ONLY` - only the external reference may be kept, never the
 *                      nutrient values.
 */
export type PersistencePolicy = "PERMANENT" | "CACHE_WITH_TTL" | "REFERENCE_ONLY";

export interface ProviderCachePolicy {
  /** How long a query's result list stays usable. */
  searchTtlMs: number;
  /** How long one food's normalized content stays usable. */
  contentTtlMs: number;
  persistence: PersistencePolicy;
  /**
   * Whether an expired answer may still be served while the provider is
   * unreachable. True for an open database, where yesterday's numbers beat an
   * error message; false where the terms only allow a live, time-boxed cache.
   */
  serveStaleOnOutage: boolean;
}

/** EAN-8/12/13/14 and UPC-A. */
export const isBarcode = (value: string) => /^\d{8}$|^\d{12,14}$/.test(value.trim());
