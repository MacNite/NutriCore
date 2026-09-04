/**
 * USDA FoodData Central over its public API.
 *
 * NutriCore bundles the Foundation Foods and SR Legacy downloads, so this
 * adapter is not what makes USDA data available - it is what extends it. The
 * bundled release covers 8,156 generic foods and answers offline; the API adds
 * everything published since, plus the Survey (FNDDS) and Branded data types
 * that are far too large to ship. It is therefore optional, off unless a key
 * is configured, and never required for the application to work.
 *
 * The API key is read from the environment inside this module and never leaves
 * the server: it is placed in the query string of an outbound request and is
 * not part of any value returned to a caller.
 *
 * Two response shapes have to be handled, which is the one real subtlety here.
 * `/foods/search` returns `foodNutrients[{nutrientId, value}]` with portions in
 * `foodMeasures`, while `/food/{id}` returns `foodNutrients[{nutrient:{id},
 * amount}]` with portions in `foodPortions`. Both are translated into the same
 * record shape the bundled importer uses, so the nutrient map, the unit
 * handling and the food-type reading exist once.
 */
import { ProviderUnavailableError, type FoodProvider, type NormalizedFood } from "./food";
import { RateGate, delay, jitter } from "@/lib/rate-gate";
import { logger } from "@/lib/logger";
import { mapUsdaRecord, USDA_PROVIDER, type UsdaFoodRecord, type UsdaNutrientTuple, type UsdaPortion } from "@/server/food-datasets/usda";

const DEFAULT_BASE_URL = "https://api.nal.usda.gov/fdc/v1";

/**
 * The data types worth searching, most trustworthy first.
 *
 * Branded is included because the API is the only way to reach it, but it is
 * last: Open Food Facts remains NutriCore's product source, and a Branded hit
 * is a bonus rather than the point of asking USDA.
 */
const DATA_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"];

/**
 * FoodData Central allows 1,000 requests per hour per key, which is a little
 * under 17 a minute. Paced just below that, with a burst so that a person
 * pressing search a few times is never slowed down.
 */
const SEARCH_GATE = RateGate.perMinute(15, 5);

/** Test seam, matching the Open Food Facts provider. */
export function resetUsdaThrottle() {
  SEARCH_GATE.reset();
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface UsdaOptions {
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  timeoutMs?: number;
  retryDelaysMs?: number[];
  maxQueueMs?: number;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const text = (value: unknown): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? undefined : trimmed;
};

/** A `/foods/search` hit, whose nutrients are flattened and renamed. */
interface SearchHit {
  fdcId?: unknown;
  description?: unknown;
  dataType?: unknown;
  foodCategory?: unknown;
  publishedDate?: unknown;
  ndbNumber?: unknown;
  brandOwner?: unknown;
  brandName?: unknown;
  gtinUpc?: unknown;
  servingSize?: unknown;
  servingSizeUnit?: unknown;
  foodNutrients?: unknown;
  foodMeasures?: unknown;
}

/** `/food/{id}`, the full record - the same shape the bulk downloads use. */
interface FullFood extends SearchHit {
  foodPortions?: unknown;
}

function searchNutrients(raw: unknown): UsdaNutrientTuple[] {
  if (!Array.isArray(raw)) return [];
  const tuples: UsdaNutrientTuple[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    // The search response flattens the nutrient; the full record nests it.
    const nested = (record.nutrient ?? null) as Record<string, unknown> | null;
    const id = numberOrNull(nested?.id ?? record.nutrientId);
    const amount = numberOrNull(record.amount ?? record.value);
    if (id === null || amount === null) continue;
    const unit = text(nested?.unitName ?? record.unitName) ?? null;
    const numberTag = text(nested?.number ?? record.nutrientNumber) ?? null;
    tuples.push([id, numberTag, unit, amount]);
  }
  return tuples;
}

function searchPortions(raw: unknown): UsdaPortion[] {
  if (!Array.isArray(raw)) return [];
  const portions: UsdaPortion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const gramWeight = numberOrNull(record.gramWeight);
    if (gramWeight === null || gramWeight <= 0) continue;
    const measure = (record.measureUnit ?? null) as Record<string, unknown> | null;
    portions.push({
      amount: numberOrNull(record.amount ?? record.value),
      unit: text(measure?.name) ?? text(record.measureUnitName) ?? null,
      abbreviation: text(measure?.abbreviation) ?? text(record.measureUnitAbbreviation) ?? null,
      // `disseminationText` is the search response's human-readable measure
      // ("1 cup, chopped"); the full record puts the same thing in `modifier`.
      modifier: text(record.modifier) ?? text(record.disseminationText) ?? null,
      gramWeight,
      sequence: numberOrNull(record.rank ?? record.sequenceNumber),
    });
  }
  return portions;
}

/** Either response shape -> the record shape the shared mapper understands. */
export function toUsdaRecord(hit: SearchHit | FullFood): UsdaFoodRecord | null {
  const fdcId = numberOrNull(hit.fdcId);
  const description = text(hit.description);
  if (fdcId === null || !description) return null;

  const category = typeof hit.foodCategory === "string" ? hit.foodCategory : text((hit.foodCategory as Record<string, unknown> | null)?.description);

  return {
    fdcId,
    dataType: text(hit.dataType) ?? null,
    description,
    category: category ?? null,
    ndbNumber: text(hit.ndbNumber) ?? null,
    publicationDate: text(hit.publishedDate) ?? null,
    nutrients: searchNutrients(hit.foodNutrients),
    portions: searchPortions("foodPortions" in hit ? (hit as FullFood).foodPortions : hit.foodMeasures),
    brand: text(hit.brandName) ?? text(hit.brandOwner) ?? null,
    barcode: text(hit.gtinUpc) ?? null,
    servingSize: numberOrNull(hit.servingSize),
    servingSizeUnit: text(hit.servingSizeUnit) ?? null,
  };
}

export class UsdaProvider implements FoodProvider {
  readonly name = USDA_PROVIDER;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];
  private readonly maxQueueMs: number;
  public readonly enabled: boolean;

  constructor(options: UsdaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.USDA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = (options.apiKey ?? process.env.USDA_API_KEY ?? "").trim();
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.retryDelaysMs = options.retryDelaysMs ?? [600, 1800];
    this.maxQueueMs = options.maxQueueMs ?? 8000;
    // A key is what makes this adapter usable at all: without one, FDC answers
    // 403 for every request, so the source reports itself unavailable instead
    // of failing every search with an error the user cannot act on.
    const configured = (process.env.USDA_ENABLED ?? "true") !== "false";
    this.enabled = options.enabled ?? (configured && this.apiKey !== "");
  }

  private async attempt(path: string, body: unknown): Promise<unknown> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${separator}api_key=${encodeURIComponent(this.apiKey)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      const reason = name === "AbortError" || name === "TimeoutError" ? "TIMEOUT" : "NETWORK";
      throw new ProviderUnavailableError(this.name, "FoodData Central is unreachable", cause, reason);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
      // 403 from FDC means the key is missing, wrong or over its quota. It is
      // logged without the key itself, and it is not retried.
      logger.warn("FoodData Central upstream HTTP error", {
        provider: this.name,
        status: response.status,
        retryAfterSeconds,
      });
      throw new ProviderUnavailableError(
        this.name,
        `FoodData Central responded with ${response.status}`,
        undefined,
        response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
        retryAfterSeconds,
        response.status,
      );
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new ProviderUnavailableError(this.name, "FoodData Central returned malformed JSON", cause);
    }
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    let lastError: ProviderUnavailableError | undefined;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      if (lastError) {
        const advised = (lastError.retryAfterSeconds ?? 0) * 1000;
        if (advised > this.maxQueueMs) break;
        await delay(jitter(Math.max(this.retryDelaysMs[attempt - 1], advised)));
      }

      const slot = SEARCH_GATE.reserve(this.maxQueueMs);
      if (slot === null) {
        throw new ProviderUnavailableError(
          this.name,
          "Local FoodData Central request budget is exhausted",
          undefined,
          "RATE_LIMITED",
          Math.ceil(this.maxQueueMs / 1000),
        );
      }
      await delay(slot);

      try {
        return await this.attempt(path, body);
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        const retryable =
          error.reason === "TIMEOUT" ||
          error.reason === "NETWORK" ||
          (error.upstreamStatus !== undefined && RETRYABLE_STATUS.has(error.upstreamStatus));
        if (!retryable) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  /**
   * Deliberately never answers a barcode.
   *
   * FoodData Central does hold GTINs on its Branded data type, but Open Food
   * Facts is NutriCore's product source and asking a second product database
   * for the same scan only spends quota. The tier registry does not list USDA
   * as a barcode source; this is here because the interface requires it.
   */
  async getByBarcode(): Promise<NormalizedFood | null> {
    return null;
  }

  async search(query: string, options: { limit?: number; locale?: string } = {}): Promise<NormalizedFood[]> {
    if (!this.enabled) return [];
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const payload = await this.request("/foods/search", {
      query: trimmed,
      dataType: DATA_TYPES,
      pageSize: Math.min(Math.max(options.limit ?? 25, 1), 50),
      // FDC's own relevance ordering; NutriCore re-ranks everything anyway.
      sortBy: "dataType.keyword",
      sortOrder: "asc",
    });

    const foods = (payload as { foods?: unknown } | null)?.foods;
    if (!Array.isArray(foods)) return [];

    const normalized: NormalizedFood[] = [];
    for (const hit of foods) {
      if (!hit || typeof hit !== "object") continue;
      const food = this.normalizeProduct(hit as Record<string, unknown>);
      if (food) normalized.push(food);
    }
    return normalized;
  }

  /** One FDC record, in either response shape, as a NormalizedFood. */
  normalizeProduct(product: Record<string, unknown>): NormalizedFood | null {
    const record = toUsdaRecord(product as SearchHit);
    if (!record) return null;
    const mapped = mapUsdaRecord(record);
    if (!mapped || Object.keys(mapped.nutrients).length === 0) return null;

    const nutrients: Record<string, number | null> = {};
    for (const [key, nutrient] of Object.entries(mapped.nutrients)) nutrients[key] = nutrient.value;

    const serving = mapped.servings.find((entry) => entry.isDefault) ?? mapped.servings[0];

    return {
      externalId: mapped.externalId,
      ...(record.barcode ? { barcode: record.barcode } : {}),
      name: mapped.name,
      ...(record.brand ? { brand: record.brand } : {}),
      locale: "en",
      basisAmount: mapped.basisAmount,
      basisUnit: mapped.basisUnit,
      ...(serving?.gramEquivalent ? { servingAmount: serving.gramEquivalent, servingUnit: "g", servingLabel: serving.label } : {}),
      nutrients,
      foodType: mapped.foodType,
      // FDC states every nutrient it determined and omits the rest, so a
      // record is never a partial view of a fuller one the way an Open Food
      // Facts search hit is.
      partial: false,
      provenance: {
        provider: this.name,
        providerId: mapped.externalId,
        retrievedAt: new Date(),
        url: `https://fdc.nal.usda.gov/food-details/${mapped.externalId}/nutrients`,
        confidence: record.dataType === "Branded" ? 0.8 : 0.92,
        estimated: false,
      },
      raw: mapped.metadata,
    };
  }
}
