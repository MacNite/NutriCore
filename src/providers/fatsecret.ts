/**
 * FatSecret, as an optional verified fallback.
 *
 * It is the last text-search tier for a reason. NutriCore's foundations are
 * the databases it can keep - BLS, USDA, Open Food Facts - and the FatSecret
 * Platform API terms do not permit accumulating a copy of theirs. So this
 * adapter exists to answer the queries the open databases could not, and what
 * it returns is cached rather than collected: the source registry gives it
 * `CACHE_WITH_TTL`, its foods carry an expiry, and they are pruned once
 * nothing references them.
 *
 * Everything here is server-side. The client id and secret are read from the
 * environment in this module, exchanged for a bearer token over HTTPS, and
 * neither ever appears in a value returned to a caller.
 *
 * Two plan-dependent capabilities are handled by stepping aside rather than by
 * pretending:
 *
 *  - Barcode lookup and non-US localisation are premier-tier features. When
 *    the configured credentials cannot use them, the capability reports itself
 *    unavailable and the search moves on. It never falls back to a different
 *    region's data, because a US product returned for a German barcode is a
 *    wrong answer rather than a partial one.
 *  - The Platform API authorises by IP address. A self-hosted instance on a
 *    changing address will be refused with error 21, which is reported as a
 *    configuration problem in diagnostics instead of looking like an outage.
 */
import { ProviderUnavailableError, type FoodProvider, type NormalizedFood } from "./food";
import { RateGate, delay, jitter } from "@/lib/rate-gate";
import { logger } from "@/lib/logger";

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const API_URL = "https://platform.fatsecret.com/rest/server.api";

/** Politeness pacing; FatSecret's own limit depends on the plan. */
const API_GATE = RateGate.perMinute(30, 8);

/**
 * FatSecret error codes this adapter reads rather than guesses at.
 *
 * 21 is the one a self-hosted deployment actually hits: the Platform API only
 * answers requests from an IP address registered with the account.
 */
const ERROR_INVALID_TOKEN = 13;
const ERROR_INVALID_IP = 21;
/** "Method not found"/"not available for this plan" family. */
const CAPABILITY_ERRORS = new Set([2, 12, 14]);

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Module scope: a provider instance is created per request. */
let cachedToken: CachedToken | null = null;

/** Test seam. */
export function resetFatSecretState() {
  cachedToken = null;
  API_GATE.reset();
}

/**
 * The FatSecret fields whose unit is documented and unambiguous.
 *
 * Deliberately short. `calcium`, `iron`, `vitamin_a` and `vitamin_c` are
 * omitted because FatSecret has published them as percentages of a daily value
 * in some API versions and as absolute masses in others: importing them would
 * be a guess at a factor, and a mineral that is wrong by 100x is worse than a
 * mineral that is missing.
 */
const NUTRIENT_FIELDS: { field: string; key: string; unit: "g" | "mg" | "µg" | "kcal" }[] = [
  { field: "calories", key: "energyKcal", unit: "kcal" },
  { field: "protein", key: "protein", unit: "g" },
  { field: "carbohydrate", key: "carbohydrate", unit: "g" },
  { field: "fat", key: "fat", unit: "g" },
  { field: "saturated_fat", key: "saturatedFat", unit: "g" },
  { field: "monounsaturated_fat", key: "monounsaturatedFat", unit: "g" },
  { field: "polyunsaturated_fat", key: "polyunsaturatedFat", unit: "g" },
  { field: "trans_fat", key: "transFat", unit: "g" },
  { field: "fiber", key: "fiber", unit: "g" },
  { field: "sugar", key: "sugar", unit: "g" },
  { field: "cholesterol", key: "cholesterol", unit: "mg" },
  { field: "sodium", key: "sodium", unit: "mg" },
  { field: "potassium", key: "potassium", unit: "mg" },
  { field: "vitamin_d", key: "vitaminD", unit: "µg" },
];

/** NutriCore stores sodium in grams; FatSecret states it in milligrams. */
const TO_CANONICAL: Record<string, number> = { sodium: 0.001 };

const numeric = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? undefined : trimmed;
};

/** FatSecret returns a single object where a one-element array is meant. */
const asArray = <T>(value: T | T[] | undefined | null): T[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

export interface FatSecretServing {
  serving_id?: unknown;
  serving_description?: unknown;
  measurement_description?: unknown;
  metric_serving_amount?: unknown;
  metric_serving_unit?: unknown;
  number_of_units?: unknown;
  [nutrient: string]: unknown;
}

export interface FatSecretFood {
  food_id?: unknown;
  food_name?: unknown;
  brand_name?: unknown;
  food_type?: unknown;
  food_url?: unknown;
  servings?: { serving?: FatSecretServing | FatSecretServing[] };
}

/** Raised when a capability the plan does not include was asked for. */
export class FatSecretCapabilityError extends Error {
  constructor(public readonly capability: string) {
    super(`FatSecret plan does not provide ${capability}`);
    this.name = "FatSecretCapabilityError";
  }
}

export interface FatSecretOptions {
  clientId?: string;
  clientSecret?: string;
  region?: string;
  language?: string;
  enabled?: boolean;
  timeoutMs?: number;
  tokenUrl?: string;
  apiUrl?: string;
  retryDelaysMs?: number[];
  maxQueueMs?: number;
}

export class FatSecretProvider implements FoodProvider {
  readonly name = "FATSECRET";

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly region?: string;
  private readonly language?: string;
  private readonly timeoutMs: number;
  private readonly tokenUrl: string;
  private readonly apiUrl: string;
  private readonly retryDelaysMs: number[];
  private readonly maxQueueMs: number;
  public readonly enabled: boolean;

  constructor(options: FatSecretOptions = {}) {
    this.clientId = (options.clientId ?? process.env.FATSECRET_CLIENT_ID ?? "").trim();
    this.clientSecret = (options.clientSecret ?? process.env.FATSECRET_CLIENT_SECRET ?? "").trim();
    this.region = text(options.region ?? process.env.FATSECRET_REGION);
    this.language = text(options.language ?? process.env.FATSECRET_LANGUAGE);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.tokenUrl = options.tokenUrl ?? TOKEN_URL;
    this.apiUrl = options.apiUrl ?? API_URL;
    this.retryDelaysMs = options.retryDelaysMs ?? [500, 1500];
    this.maxQueueMs = options.maxQueueMs ?? 6000;

    const configured = (process.env.FATSECRET_ENABLED ?? "false") === "true" || process.env.FATSECRET_ENABLED === "1";
    // Credentials are part of being enabled: an installation that has not
    // configured FatSecret must behave exactly as it did before it existed.
    this.enabled = options.enabled ?? (configured && this.clientId !== "" && this.clientSecret !== "");
  }

  /** Exchanges the client credentials for a bearer token, once per lifetime. */
  private async accessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    let response: Response;
    try {
      response = await fetch(this.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials&scope=basic",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      throw new ProviderUnavailableError(
        this.name,
        "FatSecret authentication is unreachable",
        cause,
        name === "AbortError" || name === "TimeoutError" ? "TIMEOUT" : "NETWORK",
      );
    }

    if (!response.ok) {
      // Never logged with the credentials, only with the status.
      logger.warn("FatSecret token request failed", { provider: this.name, status: response.status });
      throw new ProviderUnavailableError(
        this.name,
        `FatSecret authentication responded with ${response.status}`,
        undefined,
        response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
        undefined,
        response.status,
      );
    }

    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    const token = text(payload.access_token);
    if (!token) throw new ProviderUnavailableError(this.name, "FatSecret returned no access token");
    const lifetime = numeric(payload.expires_in) ?? 86_400;
    cachedToken = { token, expiresAt: Date.now() + lifetime * 1000 };
    return token;
  }

  private async attempt(params: Record<string, string>): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    const body = new URLSearchParams({ ...params, format: "json" });
    // Region and language are premier features; sending them on a basic plan
    // is answered with a capability error, which the caller handles by
    // skipping rather than by silently returning US data.
    if (this.region) body.set("region", this.region);
    if (this.language) body.set("language", this.language);

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      throw new ProviderUnavailableError(
        this.name,
        "FatSecret is unreachable",
        cause,
        name === "AbortError" || name === "TimeoutError" ? "TIMEOUT" : "NETWORK",
      );
    }

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new ProviderUnavailableError(
        this.name,
        `FatSecret responded with ${response.status}`,
        undefined,
        response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
        retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined,
        response.status,
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch (cause) {
      throw new ProviderUnavailableError(this.name, "FatSecret returned malformed JSON", cause);
    }

    // FatSecret reports failures as HTTP 200 with an error object.
    const error = payload.error as { code?: unknown; message?: unknown } | undefined;
    if (error) {
      const code = numeric(error.code) ?? 0;
      const message = text(error.message) ?? "unknown error";
      if (code === ERROR_INVALID_TOKEN) {
        cachedToken = null;
        throw new ProviderUnavailableError(this.name, "FatSecret token rejected", undefined, "UNAVAILABLE");
      }
      if (code === ERROR_INVALID_IP) {
        logger.warn(
          "FatSecret refused the request: the Platform API only answers registered IP addresses. Add this deployment's outbound address to the FatSecret account.",
          { provider: this.name },
        );
        throw new ProviderUnavailableError(this.name, "FatSecret IP address is not registered", undefined, "HTTP_ERROR");
      }
      if (CAPABILITY_ERRORS.has(code)) throw new FatSecretCapabilityError(message);
      throw new ProviderUnavailableError(this.name, `FatSecret error ${code}: ${message}`);
    }

    return payload;
  }

  private async request(params: Record<string, string>): Promise<Record<string, unknown>> {
    let lastError: ProviderUnavailableError | undefined;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      if (lastError) {
        const advised = (lastError.retryAfterSeconds ?? 0) * 1000;
        if (advised > this.maxQueueMs) break;
        await delay(jitter(Math.max(this.retryDelaysMs[attempt - 1], advised)));
      }

      const slot = API_GATE.reserve(this.maxQueueMs);
      if (slot === null) {
        throw new ProviderUnavailableError(
          this.name,
          "Local FatSecret request budget is exhausted",
          undefined,
          "RATE_LIMITED",
          Math.ceil(this.maxQueueMs / 1000),
        );
      }
      await delay(slot);

      try {
        return await this.attempt(params);
      } catch (error) {
        // A capability the plan lacks is not a failure to retry.
        if (error instanceof FatSecretCapabilityError) throw error;
        if (!(error instanceof ProviderUnavailableError)) throw error;
        const retryable =
          error.reason === "TIMEOUT" ||
          error.reason === "NETWORK" ||
          error.reason === "UNAVAILABLE" ||
          (error.upstreamStatus !== undefined && error.upstreamStatus >= 500);
        if (!retryable) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  /**
   * A barcode, if the configured plan can look one up.
   *
   * Returns null - rather than throwing - when it cannot, so Open Food Facts
   * remains the barcode source and a basic FatSecret plan costs a scan nothing
   * but one skipped tier.
   */
  async getByBarcode(barcode: string): Promise<NormalizedFood | null> {
    if (!this.enabled) return null;
    const digits = barcode.trim();
    if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return null;
    // FatSecret expects GTIN-13; a UPC-A is the same number with a leading zero.
    const gtin13 = digits.length === 12 ? `0${digits}` : digits;

    let foodId: string | undefined;
    try {
      const payload = await this.request({ method: "food.find_id_for_barcode", barcode: gtin13 });
      const value = (payload.food_id as { value?: unknown } | undefined)?.value;
      foodId = text(value) ?? (numeric(value) !== null ? String(numeric(value)) : undefined);
    } catch (error) {
      if (error instanceof FatSecretCapabilityError) {
        logger.info("FatSecret barcode lookup is not available on this plan; skipping", { provider: this.name });
        return null;
      }
      throw error;
    }

    // "0" is FatSecret's way of saying it does not know this barcode.
    if (!foodId || foodId === "0") return null;
    return this.getById(foodId);
  }

  async getById(foodId: string): Promise<NormalizedFood | null> {
    const payload = await this.request({ method: "food.get.v2", food_id: foodId });
    const food = payload.food as FatSecretFood | undefined;
    if (!food) return null;
    return this.normalizeProduct(food as Record<string, unknown>);
  }

  /**
   * Searches, then fetches each hit's full record.
   *
   * `foods.search` returns only a prose summary of the macros
   * ("Per 100g - Calories: 52kcal | Fat: 0.17g | ..."), and parsing English
   * prose into nutrient values is exactly the kind of guessing this codebase
   * avoids. So the search is used for identity only and the numbers come from
   * `food.get.v2`, which states them as fields. That costs one request per
   * result, which is why the tier is last and why the result count is small.
   */
  async search(query: string, options: { limit?: number; locale?: string } = {}): Promise<NormalizedFood[]> {
    if (!this.enabled) return [];
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const maxResults = Math.min(Math.max(options.limit ?? 5, 1), 10);
    let payload: Record<string, unknown>;
    try {
      payload = await this.request({
        method: "foods.search",
        search_expression: trimmed,
        max_results: String(maxResults),
      });
    } catch (error) {
      if (error instanceof FatSecretCapabilityError) {
        logger.info("FatSecret search is not available with these credentials; skipping", { provider: this.name });
        return [];
      }
      throw error;
    }

    const hits = asArray((payload.foods as { food?: FatSecretFood | FatSecretFood[] } | undefined)?.food);
    const results: NormalizedFood[] = [];
    for (const hit of hits) {
      const foodId = text(hit.food_id) ?? (numeric(hit.food_id) !== null ? String(numeric(hit.food_id)) : undefined);
      if (!foodId) continue;
      try {
        const food = await this.getById(foodId);
        if (food) results.push(food);
      } catch (error) {
        if (error instanceof FatSecretCapabilityError) return results;
        // One unreadable record must not lose the others.
        if (error instanceof ProviderUnavailableError && error.reason !== "RATE_LIMITED") {
          logger.warn("FatSecret food lookup failed", { provider: this.name, reason: error.reason });
          continue;
        }
        throw error;
      }
    }
    return results;
  }

  /**
   * One FatSecret food as a NormalizedFood, on a 100 g or 100 ml basis.
   *
   * FatSecret states nutrients per serving, so a serving that also carries a
   * metric weight is what makes the record usable: it is the only thing that
   * says what the numbers are per. A record without one is rejected rather
   * than scaled on an assumption.
   */
  normalizeProduct(product: Record<string, unknown>): NormalizedFood | null {
    const food = product as FatSecretFood;
    const foodId = text(food.food_id) ?? (numeric(food.food_id) !== null ? String(numeric(food.food_id)) : undefined);
    const name = text(food.food_name);
    if (!foodId || !name) return null;

    const servings = asArray(food.servings?.serving);
    const metric = servings.find((serving) => {
      const amount = numeric(serving.metric_serving_amount);
      const unit = text(serving.metric_serving_unit)?.toLowerCase();
      return amount !== null && amount > 0 && (unit === "g" || unit === "ml");
    });
    if (!metric) return null;

    const metricAmount = numeric(metric.metric_serving_amount) as number;
    const basisUnit = text(metric.metric_serving_unit)?.toLowerCase() === "ml" ? "ML" : "G";
    const scale = 100 / metricAmount;

    const nutrients: Record<string, number | null> = {};
    for (const { field, key } of NUTRIENT_FIELDS) {
      const raw = numeric(metric[field]);
      // Absent means unknown. It is never read as zero.
      nutrients[key] = raw === null ? null : raw * scale * (TO_CANONICAL[key] ?? 1);
    }

    // A named portion, where the record describes one: "1 cup", "1 medium".
    const portion = servings.find((serving) => {
      const label = text(serving.measurement_description);
      return Boolean(label) && numeric(serving.metric_serving_amount) !== null;
    });
    const portionAmount = portion ? numeric(portion.metric_serving_amount) : null;
    const portionUnits = portion ? (numeric(portion.number_of_units) ?? 1) : 1;

    const brand = text(food.brand_name);
    return {
      externalId: foodId,
      name,
      ...(brand ? { brand } : {}),
      basisAmount: 100,
      basisUnit,
      ...(portionAmount && portionUnits > 0
        ? {
            servingAmount: portionAmount / portionUnits,
            servingUnit: basisUnit === "ML" ? "ml" : "g",
            servingLabel: text(portion?.serving_description) ?? text(portion?.measurement_description),
          }
        : {}),
      nutrients,
      // FatSecret's `food_type` is "Brand" or "Generic".
      foodType: text(food.food_type)?.toLowerCase() === "brand" ? "PACKAGED" : "GENERIC",
      partial: false,
      provenance: {
        provider: this.name,
        providerId: foodId,
        retrievedAt: new Date(),
        ...(text(food.food_url) ? { url: text(food.food_url) as string } : {}),
        confidence: 0.9,
        estimated: false,
      },
    };
  }
}
