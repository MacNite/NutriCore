import { ProviderUnavailableError, isBarcode, type FoodProvider, type NormalizedFood } from "./food";
import { normalizeName, parseServingSize } from "@/lib/units";
import { kjToKcal } from "@/lib/nutrition";
import { logger } from "@/lib/logger";
import { RateGate, delay, jitter } from "@/lib/rate-gate";

const FIELDS = [
  "code",
  "product_name",
  "generic_name",
  "brands",
  "quantity",
  "serving_size",
  "countries_tags",
  "lang",
  "image_front_url",
  "ingredients_text",
  "allergens",
  "nutriments",
  "nutrition_grades",
  "nova_group",
  "last_modified_t",
  "completeness",
].join(",");

/** OFF nutriment key -> NutriCore nutrient key. All values are per 100 g/ml. */
const NUTRIMENT_MAP: Record<string, string> = {
  "energy-kcal_100g": "energyKcal",
  "energy-kj_100g": "energyKj",
  proteins_100g: "protein",
  carbohydrates_100g: "carbohydrate",
  fat_100g: "fat",
  "saturated-fat_100g": "saturatedFat",
  "monounsaturated-fat_100g": "monounsaturatedFat",
  "polyunsaturated-fat_100g": "polyunsaturatedFat",
  sugars_100g: "sugar",
  fiber_100g: "fiber",
  sodium_100g: "sodium",
  salt_100g: "salt",
  calcium_100g: "calcium",
  iron_100g: "iron",
  magnesium_100g: "magnesium",
  phosphorus_100g: "phosphorus",
  potassium_100g: "potassium",
  zinc_100g: "zinc",
  copper_100g: "copper",
  manganese_100g: "manganese",
  selenium_100g: "selenium",
  "vitamin-a_100g": "vitaminA",
  "vitamin-c_100g": "vitaminC",
  "vitamin-d_100g": "vitaminD",
  "vitamin-e_100g": "vitaminE",
  "vitamin-k_100g": "vitaminK",
  "vitamin-b1_100g": "thiamin",
  "vitamin-b2_100g": "riboflavin",
  "vitamin-pp_100g": "niacin",
  "pantothenic-acid_100g": "pantothenicAcid",
  "vitamin-b6_100g": "vitaminB6",
  "vitamin-b9_100g": "folate",
  "vitamin-b12_100g": "vitaminB12",
};

/** OFF reports minerals and vitamins in grams; NutriCore stores mg/µg. */
const UNIT_SCALE: Record<string, number> = {
  calcium: 1000,
  iron: 1000,
  magnesium: 1000,
  phosphorus: 1000,
  potassium: 1000,
  zinc: 1000,
  copper: 1000,
  manganese: 1000,
  selenium: 1_000_000,
  vitaminA: 1_000_000,
  vitaminC: 1000,
  vitaminD: 1_000_000,
  vitaminE: 1000,
  vitaminK: 1_000_000,
  thiamin: 1000,
  riboflavin: 1000,
  niacin: 1000,
  pantothenicAcid: 1000,
  vitaminB6: 1000,
  folate: 1_000_000,
  vitaminB12: 1_000_000,
};

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Country tags as the taxonomy writes them: `en:germany`. Both backends send a
 * list, but a stray comma-separated string costs nothing to accept.
 */
const countryTags = (value: unknown): string[] | undefined => {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tags = raw.map((entry) => text(entry)?.toLowerCase()).filter((entry): entry is string => Boolean(entry));
  return tags.length > 0 ? tags : undefined;
};

/** A comma-separated string over the REST API, a taxonomy list in the index. */
const brandName = (value: unknown): string | undefined =>
  Array.isArray(value) ? text(value.map((entry) => text(entry)).filter(Boolean).join(", ")) : text(value);

/** Some fields the REST API types as numbers are keywords in the search index. */
const numeric = (value: unknown): number | null => {
  if (typeof value === "string" && value.trim() !== "") return number(Number(value));
  return number(value);
};

/** A unix timestamp over the REST API, an ISO date string in the search index. */
const modifiedAt = (value: unknown): Date | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000);
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
};

const text = (value: unknown): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? undefined : trimmed;
};

/**
 * Open Food Facts documents 10 requests/minute for search and 100/minute for
 * product reads, per IP, and answers 429 above them. We pace just below both.
 *
 * The burst is deliberately generous: a person pressing "search" a few times
 * in a row is the normal case and must never be slowed down, while sustained
 * traffic - several household members, or a retry storm - is spread out.
 * Module scope on purpose: a provider instance is created per request.
 */
const SEARCH_GATE = RateGate.perMinute(9, 5);
const PRODUCT_GATE = RateGate.perMinute(90, 20);
/**
 * Search-a-licious is separate, Elasticsearch-backed infrastructure built to
 * replace the legacy CGI search, and publishes no limit of its own. Pace it
 * politely anyway rather than assume none exists.
 */
const SEARCHALICIOUS_GATE = RateGate.perMinute(20, 6);

/** Test seam: lets a suite start from an empty schedule. */
export function resetOpenFoodFactsThrottle() {
  SEARCH_GATE.reset();
  PRODUCT_GATE.reset();
  SEARCHALICIOUS_GATE.reset();
  warnedUserAgents.clear();
}

/** Statuses worth a second attempt. 403 is not one: it is the User-Agent. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

const isRetryable = (error: ProviderUnavailableError) =>
  error.reason === "TIMEOUT" ||
  error.reason === "NETWORK" ||
  // A malformed body is usually an upstream error page rendered as HTML.
  error.reason === "UNAVAILABLE" ||
  (error.upstreamStatus !== undefined && RETRYABLE_STATUS.has(error.upstreamStatus));

/** One warning per process per User-Agent; this is configuration, not an event. */
const warnedUserAgents = new Set<string>();

/**
 * Open Food Facts throttles and blocks anonymous-looking clients, so it asks
 * every caller to identify itself with an application name and a contact
 * address. A default or contactless User-Agent is the most common cause of an
 * otherwise inexplicable 403.
 */
export const userAgentLooksAnonymous = (userAgent: string) =>
  /self-hosted|example\.(invalid|com|org)/i.test(userAgent) || !/[(@].+[@.)]/.test(userAgent);

/** Tuning knobs. Defaults suit a self-hosted instance; tests override them. */
export interface OpenFoodFactsOptions {
  /** Elasticsearch-backed search service; see `search`. */
  searchUrl?: string;
  /** `legacy` pins the CGI endpoint; anything else prefers Search-a-licious. */
  searchBackend?: string;
  barcodeTimeoutMs?: number;
  searchTimeoutMs?: number;
  /** Backoff before each retry. Empty disables retrying. */
  retryDelaysMs?: number[];
  /** Longest a request will sit in the local queue before failing fast. */
  maxQueueMs?: number;
}

export class OpenFoodFactsProvider implements FoodProvider {
  readonly name = "OPEN_FOOD_FACTS";

  private readonly searchUrl: string;
  private readonly searchBackend: string;
  private readonly barcodeTimeoutMs: number;
  private readonly searchTimeoutMs: number;
  private readonly retryDelaysMs: number[];
  private readonly maxQueueMs: number;

  constructor(
    private baseUrl = process.env.OPENFOODFACTS_BASE_URL ?? "https://world.openfoodfacts.org",
    private userAgent = process.env.OPENFOODFACTS_USER_AGENT ?? "NutriCore/0.1 (self-hosted)",
    public readonly enabled = (process.env.OPENFOODFACTS_ENABLED ?? "true") !== "false",
    options: OpenFoodFactsOptions = {},
  ) {
    this.searchUrl = options.searchUrl ?? process.env.OPENFOODFACTS_SEARCH_URL ?? "https://search.openfoodfacts.org";
    this.searchBackend = options.searchBackend ?? process.env.OPENFOODFACTS_SEARCH_BACKEND ?? "search-a-licious";
    this.barcodeTimeoutMs = options.barcodeTimeoutMs ?? 8000;
    this.searchTimeoutMs = options.searchTimeoutMs ?? 15_000;
    this.retryDelaysMs = options.retryDelaysMs ?? [600, 1800];
    this.maxQueueMs = options.maxQueueMs ?? 8000;
  }

  private validateConfiguration() {
    if (!userAgentLooksAnonymous(this.userAgent) || warnedUserAgents.has(this.userAgent)) return;
    warnedUserAgents.add(this.userAgent);
    logger.warn(
      "Open Food Facts User-Agent lacks an application name and contact address; requests may be blocked with 403. Set OPENFOODFACTS_USER_AGENT",
      { provider: this.name },
    );
  }

  /** One HTTP round trip. Every failure leaves as a typed provider error. */
  private async attempt(origin: string, path: string, timeoutMs: number): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${origin}${path}`, {
        headers: { "User-Agent": this.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      const reason = name === "AbortError" || name === "TimeoutError" ? "TIMEOUT" : "NETWORK";
      throw new ProviderUnavailableError(this.name, "Open Food Facts is unreachable", cause, reason);
    }

    // A missing product is a normal answer, not an outage.
    if (response.status === 404) return null;
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
      logger.warn("Open Food Facts upstream HTTP error", {
        provider: this.name,
        status: response.status,
        statusText: response.statusText,
        retryAfterSeconds,
      });
      throw new ProviderUnavailableError(
        this.name,
        `Open Food Facts responded with ${response.status}`,
        undefined,
        response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
        retryAfterSeconds,
        response.status,
      );
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new ProviderUnavailableError(this.name, "Open Food Facts returned malformed JSON", cause);
    }
  }

  /**
   * Paces the call against the provider's published limit, then retries a
   * transient failure a couple of times. Most Open Food Facts errors are a
   * momentarily overloaded backend, so a short backoff turns what the user
   * would have seen as an error into a slightly slower answer.
   */
  private async request(origin: string, path: string, timeoutMs: number, gate: RateGate): Promise<unknown> {
    this.validateConfiguration();

    let lastError: ProviderUnavailableError | undefined;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      if (lastError) {
        // Prefer the provider's own Retry-After, but only while it is short
        // enough to be worth holding the request open for.
        const advised = (lastError.retryAfterSeconds ?? 0) * 1000;
        if (advised > this.maxQueueMs) break;
        await delay(jitter(Math.max(this.retryDelaysMs[attempt - 1], advised)));
      }

      const slot = gate.reserve(this.maxQueueMs);
      if (slot === null) {
        throw new ProviderUnavailableError(
          this.name,
          "Local Open Food Facts request budget is exhausted",
          undefined,
          "RATE_LIMITED",
          Math.ceil(this.maxQueueMs / 1000),
        );
      }
      await delay(slot);

      try {
        return await this.attempt(origin, path, timeoutMs);
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError) || !isRetryable(error)) throw error;
        lastError = error;
      }
    }

    logger.warn("Open Food Facts request failed after retries", {
      provider: this.name,
      attempts: this.retryDelaysMs.length + 1,
      reason: lastError?.reason,
      status: lastError?.upstreamStatus,
    });
    throw lastError;
  }

  normalizeProduct(
    product: Record<string, unknown>,
    options: { partial?: boolean; locale?: string } = {},
  ): NormalizedFood | null {
    const code = text(product.code);
    if (!code) return null;

    const nutriments = (product.nutriments ?? {}) as Record<string, unknown>;
    const nutrients: Record<string, number | null> = {};
    for (const [offKey, key] of Object.entries(NUTRIMENT_MAP)) {
      const raw = number(nutriments[offKey]);
      nutrients[key] = raw === null ? null : raw * (UNIT_SCALE[key] ?? 1);
    }

    // Derive the missing half of each paired value rather than leaving a hole,
    // but never overwrite a value the source actually provided.
    if (nutrients.energyKcal === null && nutrients.energyKj !== null) {
      nutrients.energyKcal = kjToKcal(nutrients.energyKj);
    }
    if (nutrients.salt === null && nutrients.sodium !== null) nutrients.salt = nutrients.sodium * 2.5;
    if (nutrients.sodium === null && nutrients.salt !== null) nutrients.sodium = nutrients.salt / 2.5;

    // OFF publishes per-100 g values for solids and per-100 ml for drinks; the
    // quantity string is the only hint which one applies.
    const quantity = text(product.quantity) ?? "";
    const basisUnit = /\b\d+\s*(ml|cl|dl|l)\b/i.test(quantity) ? "ML" : "G";

    const servingSize = text(product.serving_size);
    const serving = parseServingSize(servingSize);
    // Search-a-licious flattens its multilingual fields back out, so a hit
    // carries `product_name` in the product's own language plus a
    // `product_name_<lang>` sibling per translation. Prefer the user's.
    const name =
      (options.locale ? text(product[`product_name_${options.locale}`]) : undefined) ??
      text(product.product_name) ??
      (options.locale ? text(product[`generic_name_${options.locale}`]) : undefined) ??
      text(product.generic_name);
    const lang = text(product.lang);

    return {
      externalId: code,
      barcode: code,
      name: name ?? code,
      brand: brandName(product.brands),
      locale: lang === "de" || lang === "en" ? lang : undefined,
      countries: countryTags(product.countries_tags),
      basisAmount: 100,
      basisUnit,
      servingAmount: serving?.amount,
      servingUnit: serving?.unit,
      servingLabel: servingSize,
      nutrients,
      partial: options.partial,
      provenance: {
        provider: this.name,
        providerId: code,
        retrievedAt: new Date(),
        providerUpdatedAt: modifiedAt(product.last_modified_t),
        url: `${this.baseUrl}/product/${code}`,
        confidence: number(product.completeness) ?? undefined,
        estimated: false,
      },
      raw: {
        imageUrl: text(product.image_front_url),
        ingredientsText: text(product.ingredients_text),
        allergens: text(product.allergens),
        nutritionGrade: text(product.nutrition_grades),
        novaGroup: numeric(product.nova_group),
        quantity: text(product.quantity),
        countries: product.countries_tags,
      },
    };
  }

  async getByBarcode(barcode: string): Promise<NormalizedFood | null> {
    const code = barcode.trim();
    if (!isBarcode(code)) return null;
    const data = (await this.request(this.baseUrl, `/api/v2/product/${code}.json?fields=${FIELDS}`, this.barcodeTimeoutMs, PRODUCT_GATE)) as
      | { status?: number; product?: Record<string, unknown> }
      | null;
    if (!data || data.status !== 1 || !data.product) return null;
    return this.normalizeProduct(data.product);
  }

  /**
   * Prefers Search-a-licious and falls back to the legacy CGI search.
   *
   * The legacy `/cgi/search.pl` is the Perl backend Open Food Facts is
   * retiring; under load it answers 503 for minutes at a time, which is what
   * users saw as "Open Food Facts hat einen Fehler gemeldet". Search-a-licious
   * is the Elasticsearch service built to replace it and runs on separate
   * infrastructure, so it is both faster and unlikely to be down at the same
   * moment. The fallback keeps the old path available for the reverse case.
   */
  async search(query: string, options: { limit?: number; locale?: string } = {}): Promise<NormalizedFood[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];
    if (this.searchBackend === "legacy") return this.legacySearch(trimmed, options);

    try {
      return await this.searchAlicious(trimmed, options);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      logger.warn("Search-a-licious failed; falling back to the legacy search endpoint", {
        provider: this.name,
        reason: error.reason,
        status: error.upstreamStatus,
      });
      try {
        return await this.legacySearch(trimmed, options);
      } catch {
        // The fallback's own failure is noise: report the primary backend's.
        throw error;
      }
    }
  }

  /** https://search.openfoodfacts.org - `GET /search`, Elasticsearch-backed. */
  private async searchAlicious(query: string, options: { limit?: number; locale?: string }): Promise<NormalizedFood[]> {
    // List parameters are comma-separated, not repeated. `fields` is left
    // unset: the projection also gates the image URLs the service derives
    // from the barcode, and a search page is small enough not to trim.
    const params = new URLSearchParams({
      q: query,
      page_size: String(Math.min(options.limit ?? 10, 50)),
      boost_phrase: "true",
    });
    // Language drives which localised product name ranks and is returned.
    params.set("langs", options.locale && options.locale !== "en" ? `${options.locale},en` : "en");

    const data = (await this.request(this.searchUrl, `/search?${params}`, this.searchTimeoutMs, SEARCHALICIOUS_GATE)) as
      | { hits?: Record<string, unknown>[] }
      | null;

    // The index carries the macronutrients only - no vitamins or minerals -
    // so these products must never overwrite a fuller record.
    return (data?.hits ?? [])
      .map((hit) => this.normalizeProduct(hit, { partial: true, locale: options.locale }))
      .filter((food): food is NormalizedFood => food !== null && normalizeName(food.name).length > 0);
  }

  /** The original Perl endpoint: complete nutriments, unreliable under load. */
  private async legacySearch(query: string, options: { limit?: number; locale?: string }): Promise<NormalizedFood[]> {
    // `search_terms` is the free-text parameter. An earlier implementation
    // used `categories_tags_en`, which filters by category tag and therefore
    // returned nothing for ordinary product searches.
    const params = new URLSearchParams({
      search_terms: query,
      search_simple: "1",
      action: "process",
      sort_by: "unique_scans_n",
      fields: FIELDS,
      page_size: String(Math.min(options.limit ?? 10, 50)),
      json: "1",
    });
    if (options.locale) {
      params.set("lc", options.locale);
    }

    const data = (await this.request(this.baseUrl, `/cgi/search.pl?${params}`, this.searchTimeoutMs, SEARCH_GATE)) as
      | { products?: Record<string, unknown>[] }
      | null;
    return (data?.products ?? [])
      .map((product) => this.normalizeProduct(product, { locale: options.locale }))
      .filter((food): food is NormalizedFood => food !== null && normalizeName(food.name).length > 0);
  }
}
