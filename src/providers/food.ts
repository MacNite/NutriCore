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
  /** null means "unknown". It is never coerced to zero. */
  nutrients: z.record(z.string(), z.number().nullable()),
  provenance: provenanceSchema,
  raw: z.unknown().optional(),
});

export type NormalizedFood = z.infer<typeof normalizedFoodSchema>;

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly cause?: unknown,
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

/** EAN-8/12/13/14 and UPC-A. */
export const isBarcode = (value: string) => /^\d{8}$|^\d{12,14}$/.test(value.trim());
