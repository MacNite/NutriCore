import { ProviderUnavailableError, isBarcode, type FoodProvider, type NormalizedFood } from "./food";
import { normalizeName, parseServingSize } from "@/lib/units";
import { kjToKcal } from "@/lib/nutrition";
import { logger } from "@/lib/logger";

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

const text = (value: unknown): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? undefined : trimmed;
};

export class OpenFoodFactsProvider implements FoodProvider {
  readonly name = "OPEN_FOOD_FACTS";

  constructor(
    private baseUrl = process.env.OPENFOODFACTS_BASE_URL ?? "https://world.openfoodfacts.org",
    private userAgent = process.env.OPENFOODFACTS_USER_AGENT ?? "NutriCore/0.1 (self-hosted)",
    public readonly enabled = (process.env.OPENFOODFACTS_ENABLED ?? "true") !== "false",
    private barcodeTimeoutMs = 8000,
    private searchTimeoutMs = 15_000,
  ) {}

  private validateConfiguration() {
    if (/self-hosted|example\.invalid/i.test(this.userAgent) || !/[(@].+[@.)]/.test(this.userAgent)) {
      logger.warn("Open Food Facts User-Agent appears to be the default or lacks administrator contact information", {
        provider: this.name,
      });
    }
  }

  private async request(path: string, timeoutMs: number): Promise<unknown> {
    this.validateConfiguration();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
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

  normalizeProduct(product: Record<string, unknown>): NormalizedFood | null {
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
    const name = text(product.product_name) ?? text(product.generic_name);
    const lang = text(product.lang);

    return {
      externalId: code,
      barcode: code,
      name: name ?? code,
      brand: text(product.brands),
      locale: lang === "de" || lang === "en" ? lang : undefined,
      basisAmount: 100,
      basisUnit,
      servingAmount: serving?.amount,
      servingUnit: serving?.unit,
      servingLabel: servingSize,
      nutrients,
      provenance: {
        provider: this.name,
        providerId: code,
        retrievedAt: new Date(),
        providerUpdatedAt:
          number(product.last_modified_t) !== null ? new Date(Number(product.last_modified_t) * 1000) : undefined,
        url: `${this.baseUrl}/product/${code}`,
        confidence: number(product.completeness) ?? undefined,
        estimated: false,
      },
      raw: {
        imageUrl: text(product.image_front_url),
        ingredientsText: text(product.ingredients_text),
        allergens: text(product.allergens),
        nutritionGrade: text(product.nutrition_grades),
        novaGroup: number(product.nova_group),
        quantity: text(product.quantity),
        countries: product.countries_tags,
      },
    };
  }

  async getByBarcode(barcode: string): Promise<NormalizedFood | null> {
    const code = barcode.trim();
    if (!isBarcode(code)) return null;
    const data = (await this.request(`/api/v2/product/${code}.json?fields=${FIELDS}`, this.barcodeTimeoutMs)) as
      | { status?: number; product?: Record<string, unknown> }
      | null;
    if (!data || data.status !== 1 || !data.product) return null;
    return this.normalizeProduct(data.product);
  }

  async search(query: string, options: { limit?: number; locale?: string } = {}): Promise<NormalizedFood[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];

    // `search_terms` is the free-text parameter. The previous implementation
    // used `categories_tags_en`, which filters by category tag and therefore
    // returned nothing for ordinary product searches.
    const params = new URLSearchParams({
      search_terms: trimmed,
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

    const data = (await this.request(`/cgi/search.pl?${params}`, this.searchTimeoutMs)) as
      | { products?: Record<string, unknown>[] }
      | null;
    return (data?.products ?? [])
      .map((product) => this.normalizeProduct(product))
      .filter((food): food is NormalizedFood => food !== null && normalizeName(food.name).length > 0);
  }
}
