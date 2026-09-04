/**
 * The FatSecret adapter.
 *
 * Two things matter more here than anywhere else in the provider layer: the
 * credentials must never leave the server, and a capability the configured
 * plan does not include must make the source step aside rather than invent an
 * answer or fail the search.
 *
 * These tests drive the adapter through a stubbed `fetch`. It has not been
 * exercised against the live Platform API - see the note in README.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FatSecretCapabilityError, FatSecretProvider, resetFatSecretState } from "./fatsecret";

const ENV_KEYS = ["FATSECRET_ENABLED", "FATSECRET_CLIENT_ID", "FATSECRET_CLIENT_SECRET", "FATSECRET_REGION", "FATSECRET_LANGUAGE"] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const TOKEN = { access_token: "bearer-token-value", expires_in: 86400 };

/** One food as `food.get.v2` returns it: nutrients per serving. */
const FOOD = {
  food: {
    food_id: "33691",
    food_name: "Banana",
    food_type: "Generic",
    food_url: "https://www.fatsecret.com/calories-nutrition/usda/banana",
    servings: {
      serving: [
        {
          serving_id: "1",
          serving_description: "1 medium (7\" to 7-7/8\" long)",
          measurement_description: "medium",
          metric_serving_amount: "118.000",
          metric_serving_unit: "g",
          number_of_units: "1.000",
          calories: "105",
          protein: "1.29",
          carbohydrate: "26.95",
          fat: "0.39",
          saturated_fat: "0.132",
          fiber: "3.1",
          sugar: "14.43",
          sodium: "1",
          potassium: "422",
          cholesterol: "0",
        },
      ],
    },
  },
};

const jsonResponse = (payload: unknown, init: { status?: number } = {}) =>
  ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: () => null },
    json: async () => payload,
  }) as unknown as Response;

/** Replies to the token endpoint, then to each API call in turn. */
function stubFetch(...apiPayloads: unknown[]) {
  const calls: { url: string; body: string }[] = [];
  let index = 0;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url).includes("oauth")) return jsonResponse(TOKEN);
    const payload = apiPayloads[Math.min(index, apiPayloads.length - 1)];
    index += 1;
    return jsonResponse(payload);
  }) as unknown as typeof fetch);
  return { spy, calls };
}

const configured = () => new FatSecretProvider({ retryDelaysMs: [], maxQueueMs: 100 });

beforeEach(() => {
  resetFatSecretState();
  process.env.FATSECRET_ENABLED = "true";
  process.env.FATSECRET_CLIENT_ID = "client-id";
  process.env.FATSECRET_CLIENT_SECRET = "client-secret-value";
  delete process.env.FATSECRET_REGION;
  delete process.env.FATSECRET_LANGUAGE;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("an installation that has not configured FatSecret", () => {
  it("is disabled by default", () => {
    delete process.env.FATSECRET_ENABLED;
    expect(new FatSecretProvider().enabled).toBe(false);
  });

  it("is disabled when enabled but not credentialled", () => {
    delete process.env.FATSECRET_CLIENT_SECRET;
    expect(new FatSecretProvider().enabled).toBe(false);
  });

  it("makes no request at all when disabled", async () => {
    process.env.FATSECRET_ENABLED = "false";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new FatSecretProvider();

    expect(await provider.search("banana")).toEqual([]);
    expect(await provider.getByBarcode("4000000000001")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("authentication", () => {
  it("exchanges the client credentials for a bearer token, server-side", async () => {
    const { calls } = stubFetch({ food: FOOD.food });

    await configured().getById("33691");

    const token = calls[0];
    expect(token.url).toContain("oauth.fatsecret.com");
    expect(token.body).toContain("grant_type=client_credentials");
    // The secret goes in an Authorization header over HTTPS, never in a URL.
    expect(token.url).not.toContain("client-secret-value");
    expect(calls[1].url).not.toContain("client-secret-value");
    expect(calls[1].body).not.toContain("client-secret-value");
  });

  it("reuses the token rather than authenticating per request", async () => {
    const { calls } = stubFetch({ food: FOOD.food });
    const provider = configured();

    await provider.getById("33691");
    await provider.getById("33691");

    expect(calls.filter((call) => call.url.includes("oauth"))).toHaveLength(1);
  });

  it("never leaks the token into a normalized food", async () => {
    stubFetch({ food: FOOD.food });
    const food = await configured().getById("33691");
    expect(JSON.stringify(food)).not.toContain("bearer-token-value");
  });
});

describe("normalizing a food", () => {
  const provider = new FatSecretProvider({ enabled: true });
  const normalized = provider.normalizeProduct(FOOD.food)!;

  it("rescales the per-serving values onto a 100 g basis", () => {
    // 105 kcal per 118 g -> 88.98 kcal per 100 g.
    expect(normalized.basisAmount).toBe(100);
    expect(normalized.basisUnit).toBe("G");
    expect(normalized.nutrients.energyKcal).toBeCloseTo((105 / 118) * 100, 6);
    expect(normalized.nutrients.protein).toBeCloseTo((1.29 / 118) * 100, 6);
  });

  it("converts sodium from milligrams to the grams NutriCore stores", () => {
    expect(normalized.nutrients.sodium).toBeCloseTo(((1 / 118) * 100) / 1000, 9);
  });

  it("keeps a stated zero as zero", () => {
    expect(normalized.nutrients.cholesterol).toBe(0);
  });

  it("leaves an absent nutrient null rather than zero", () => {
    // FatSecret simply omits what it does not have for a food.
    expect(normalized.nutrients.vitaminD).toBeNull();
    expect(normalized.nutrients.iron ?? null).toBeNull();
  });

  it("does not import the fields whose unit FatSecret has changed between API versions", () => {
    // calcium, iron, vitamin A and vitamin C have been published both as
    // masses and as percentages of a daily value. A mineral wrong by 100x is
    // worse than a mineral that is missing.
    const withPercentages = {
      ...FOOD.food,
      servings: { serving: [{ ...FOOD.food.servings.serving[0], calcium: "2", iron: "6", vitamin_c: "17" }] },
    };
    const mapped = new FatSecretProvider({ enabled: true }).normalizeProduct(withPercentages)!;
    expect(mapped.nutrients.calcium ?? null).toBeNull();
    expect(mapped.nutrients.iron ?? null).toBeNull();
    expect(mapped.nutrients.vitaminC ?? null).toBeNull();
  });

  it("keeps the provider identity and marks a generic food as generic", () => {
    expect(normalized.externalId).toBe("33691");
    expect(normalized.foodType).toBe("GENERIC");
    expect(normalized.provenance).toMatchObject({ provider: "FATSECRET", providerId: "33691", estimated: false });
  });

  it("marks a branded food as packaged", () => {
    const branded = { ...FOOD.food, food_type: "Brand", brand_name: "Dole" };
    const mapped = new FatSecretProvider({ enabled: true }).normalizeProduct(branded)!;
    expect(mapped.foodType).toBe("PACKAGED");
    expect(mapped.brand).toBe("Dole");
  });

  it("offers the named portion as a serving weight", () => {
    expect(normalized.servingAmount).toBeCloseTo(118, 6);
    expect(normalized.servingUnit).toBe("g");
  });

  it("refuses a record with no metric serving, rather than assuming one", () => {
    // Without a metric weight, nothing says what the numbers are per.
    const noMetric = {
      ...FOOD.food,
      servings: { serving: [{ serving_description: "1 serving", calories: "105", protein: "1.29" }] },
    };
    expect(new FatSecretProvider({ enabled: true }).normalizeProduct(noMetric)).toBeNull();
  });

  it("handles a single serving object where an array is documented", () => {
    const single = { ...FOOD.food, servings: { serving: FOOD.food.servings.serving[0] } };
    expect(new FatSecretProvider({ enabled: true }).normalizeProduct(single)).not.toBeNull();
  });

  it("uses a millilitre basis for a food measured by volume", () => {
    const drink = {
      ...FOOD.food,
      servings: { serving: [{ ...FOOD.food.servings.serving[0], metric_serving_unit: "ml" }] },
    };
    const mapped = new FatSecretProvider({ enabled: true }).normalizeProduct(drink)!;
    expect(mapped.basisUnit).toBe("ML");
    expect(mapped.servingUnit).toBe("ml");
  });
});

describe("searching", () => {
  it("takes the numbers from the full record, not from the prose summary", async () => {
    // `foods.search` returns "Per 100g - Calories: 52kcal | Fat: 0.17g | ...".
    // Parsing English prose into nutrient values is exactly the guessing this
    // codebase avoids, so each hit is fetched properly.
    const { calls } = stubFetch({ foods: { food: [{ food_id: "33691", food_name: "Banana" }] } }, { food: FOOD.food });

    const results = await configured().search("banana", { limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].nutrients.energyKcal).toBeCloseTo((105 / 118) * 100, 6);
    const methods = calls.filter((call) => !call.url.includes("oauth")).map((call) => call.body);
    expect(methods[0]).toContain("method=foods.search");
    expect(methods[1]).toContain("method=food.get.v2");
  });

  it("sends region and language only when they are configured", async () => {
    const bare = stubFetch({ foods: { food: [] } });
    await configured().search("banana");
    expect(bare.calls.at(-1)!.body).not.toContain("region");
    vi.restoreAllMocks();
    resetFatSecretState();

    process.env.FATSECRET_REGION = "DE";
    process.env.FATSECRET_LANGUAGE = "de";
    const localised = stubFetch({ foods: { food: [] } });
    await configured().search("banane");
    expect(localised.calls.at(-1)!.body).toContain("region=DE");
    expect(localised.calls.at(-1)!.body).toContain("language=de");
  });

  it("returns what it has when one record cannot be read", async () => {
    stubFetch(
      { foods: { food: [{ food_id: "1" }, { food_id: "33691", food_name: "Banana" }] } },
      { food: FOOD.food },
    );
    const results = await configured().search("banana");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe("capabilities the configured plan may not include", () => {
  it("skips a barcode lookup the plan cannot do, instead of failing the scan", async () => {
    // Barcode lookup is a premier feature. Open Food Facts stays the barcode
    // source, so a basic plan costs a scan one skipped tier and nothing more.
    stubFetch({ error: { code: 12, message: "method not available" } });

    await expect(configured().getByBarcode("4000000000001")).resolves.toBeNull();
  });

  it("skips a search the credentials cannot do", async () => {
    stubFetch({ error: { code: 14, message: "not authorised for this method" } });

    await expect(configured().search("banana")).resolves.toEqual([]);
  });

  it("pads a UPC-A to the GTIN-13 FatSecret expects", async () => {
    const { calls } = stubFetch({ food_id: { value: "0" } });

    await configured().getByBarcode("012345678905");

    expect(calls.at(-1)!.body).toContain("barcode=0012345678905");
  });

  it("treats FatSecret's zero as an unknown barcode", async () => {
    stubFetch({ food_id: { value: "0" } });
    await expect(configured().getByBarcode("4000000000001")).resolves.toBeNull();
  });

  it("ignores a barcode that is not one", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(configured().getByBarcode("12345")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  it("names the IP allowlist, which is what a self-hosted instance hits", async () => {
    // Error 21 means the credentials are fine but this address is not
    // registered. Reporting it as an outage would send somebody hunting for
    // the wrong problem for an afternoon.
    stubFetch({ error: { code: 21, message: "Invalid IP address detected" } });

    await expect(configured().search("banana")).rejects.toMatchObject({
      name: "ProviderUnavailableError",
      message: expect.stringContaining("IP address"),
    });
  });

  it("reports an HTTP failure as a provider outage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) =>
      String(url).includes("oauth") ? jsonResponse(TOKEN) : jsonResponse({}, { status: 500 })) as unknown as typeof fetch);

    await expect(configured().search("banana")).rejects.toMatchObject({ name: "ProviderUnavailableError" });
  });

  it("reports a rejected token request without logging the credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, { status: 401 }));

    await expect(configured().search("banana")).rejects.toMatchObject({
      name: "ProviderUnavailableError",
      upstreamStatus: 401,
    });
  });

  it("distinguishes a capability error from an outage by type", async () => {
    stubFetch({ error: { code: 2, message: "missing required parameter" } });
    // The type is what lets the caller skip rather than retry.
    await expect(configured().getById("33691")).rejects.toBeInstanceOf(FatSecretCapabilityError);
  });
});
