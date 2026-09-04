/**
 * The FoodData Central API adapter.
 *
 * Its job is to turn either of FDC's two response shapes into the same
 * normalized food the bundled importer produces, without the API key ever
 * leaving the server and without a failure taking the search down with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderUnavailableError } from "./food";
import { UsdaProvider, resetUsdaThrottle, toUsdaRecord } from "./usda";

const ENV_KEYS = ["USDA_ENABLED", "USDA_API_KEY"] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/** A `/foods/search` hit: nutrients flattened, portions in `foodMeasures`. */
const searchHit = {
  fdcId: 169967,
  description: "Apples, raw, with skin",
  dataType: "SR Legacy",
  foodCategory: "Fruits and Fruit Juices",
  publishedDate: "2019-04-01",
  foodNutrients: [
    { nutrientId: 1008, nutrientNumber: "208", unitName: "kcal", value: 52 },
    { nutrientId: 1003, nutrientNumber: "203", unitName: "g", value: 0.26 },
    { nutrientId: 1005, nutrientNumber: "205", unitName: "g", value: 13.8 },
    { nutrientId: 1004, nutrientNumber: "204", unitName: "g", value: 0.17 },
    { nutrientId: 1093, nutrientNumber: "307", unitName: "mg", value: 1 },
  ],
  foodMeasures: [
    { disseminationText: "1 cup, quartered or chopped", gramWeight: 125, rank: 1, measureUnitAbbreviation: "undetermined" },
  ],
};

/** `/food/{id}`: nutrients nested, portions in `foodPortions`. */
const fullFood = {
  fdcId: 169967,
  description: "Apples, raw, with skin",
  dataType: "SR Legacy",
  foodCategory: { description: "Fruits and Fruit Juices" },
  foodNutrients: [
    { nutrient: { id: 1008, number: "208", unitName: "kcal" }, amount: 52 },
    { nutrient: { id: 1003, number: "203", unitName: "g" }, amount: 0.26 },
    { nutrient: { id: 1005, number: "205", unitName: "g" }, amount: 13.8 },
    { nutrient: { id: 1004, number: "204", unitName: "g" }, amount: 0.17 },
  ],
  foodPortions: [
    { amount: 1, measureUnit: { name: "cup", abbreviation: "cup" }, modifier: "quartered", gramWeight: 125, sequenceNumber: 1 },
  ],
};

const jsonResponse = (payload: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    statusText: "",
    headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
    json: async () => payload,
  }) as unknown as Response;

beforeEach(() => {
  resetUsdaThrottle();
  process.env.USDA_ENABLED = "true";
  process.env.USDA_API_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("being enabled at all", () => {
  it("is unavailable without an API key, whatever the switch says", async () => {
    delete process.env.USDA_API_KEY;
    const provider = new UsdaProvider();
    expect(provider.enabled).toBe(false);
    // And it answers empty rather than failing the search it is part of.
    expect(await provider.search("apple")).toEqual([]);
  });

  it("is unavailable when the switch is off, even with a key", () => {
    process.env.USDA_ENABLED = "false";
    expect(new UsdaProvider().enabled).toBe(false);
  });

  it("is available once both are set", () => {
    expect(new UsdaProvider().enabled).toBe(true);
  });
});

describe("reading either response shape", () => {
  it("normalizes a search hit", () => {
    const record = toUsdaRecord(searchHit)!;
    expect(record).toMatchObject({ fdcId: 169967, dataType: "SR Legacy", category: "Fruits and Fruit Juices" });
    expect(record.nutrients).toEqual(
      expect.arrayContaining([
        [1008, "208", "kcal", 52],
        [1093, "307", "mg", 1],
      ]),
    );
    expect(record.portions[0]).toMatchObject({ gramWeight: 125, modifier: "1 cup, quartered or chopped" });
  });

  it("normalizes a full record the same way", () => {
    const record = toUsdaRecord(fullFood)!;
    expect(record).toMatchObject({ fdcId: 169967, category: "Fruits and Fruit Juices" });
    expect(record.nutrients).toEqual(expect.arrayContaining([[1008, "208", "kcal", 52]]));
    expect(record.portions[0]).toMatchObject({ gramWeight: 125, unit: "cup", abbreviation: "cup" });
  });

  it("returns null for a record with no id or description", () => {
    expect(toUsdaRecord({ ...searchHit, fdcId: undefined })).toBeNull();
    expect(toUsdaRecord({ ...searchHit, description: "" })).toBeNull();
  });

  it("produces the same nutrients from both shapes", () => {
    const provider = new UsdaProvider();
    const fromSearch = provider.normalizeProduct(searchHit)!;
    const fromFull = provider.normalizeProduct(fullFood)!;
    expect(fromSearch.nutrients.energyKcal).toBe(fromFull.nutrients.energyKcal);
    expect(fromSearch.nutrients.protein).toBe(fromFull.nutrients.protein);
  });
});

describe("normalizing a product", () => {
  const provider = new UsdaProvider();
  const normalized = provider.normalizeProduct(searchHit)!;

  it("preserves the FDC id and links back to the record", () => {
    expect(normalized.externalId).toBe("169967");
    expect(normalized.provenance).toMatchObject({
      provider: "USDA_FDC",
      providerId: "169967",
      url: "https://fdc.nal.usda.gov/food-details/169967/nutrients",
      estimated: false,
    });
  });

  it("reports a per-100 g basis and the food's kind", () => {
    expect(normalized.basisAmount).toBe(100);
    expect(normalized.basisUnit).toBe("G");
    // A raw apple is not a packaged product, and must not be stored as one.
    expect(normalized.foodType).toBe("RAW");
  });

  it("converts sodium into the unit NutriCore stores", () => {
    expect(normalized.nutrients.sodium).toBeCloseTo(0.001, 9);
  });

  it("leaves a nutrient the record does not carry as null, not zero", () => {
    expect(normalized.nutrients.vitaminC ?? null).toBeNull();
    expect(normalized.nutrients.calcium ?? null).toBeNull();
  });

  it("offers the portion weight as a serving", () => {
    expect(normalized.servingAmount).toBe(125);
    expect(normalized.servingUnit).toBe("g");
  });

  it("is not partial: FDC omits what it did not determine", () => {
    expect(normalized.partial).toBe(false);
  });

  it("rejects a record with no mappable nutrient at all", () => {
    expect(provider.normalizeProduct({ ...searchHit, foodNutrients: [] })).toBeNull();
  });
});

describe("searching", () => {
  it("sends the key in the request and never in the result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ foods: [searchHit] }));

    const results = await new UsdaProvider().search("apple", { limit: 5 });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("api_key=test-key");
    expect(JSON.stringify(results)).not.toContain("test-key");
    expect(results).toHaveLength(1);
  });

  it("asks for the generic data types before the branded one", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ foods: [] }));

    await new UsdaProvider().search("apple");

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.dataType[0]).toBe("Foundation");
    expect(body.dataType.at(-1)).toBe("Branded");
  });

  it("returns nothing for a query too short to be meaningful", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await new UsdaProvider().search("a")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("copes with a response that carries no foods array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
    expect(await new UsdaProvider().search("apple")).toEqual([]);
  });
});

describe("never answers a barcode", () => {
  it("returns null without asking FDC", async () => {
    // Open Food Facts is the product source; spending FDC quota on a scan that
    // OFF already answered is the point of not listing USDA as a barcode tier.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await new UsdaProvider().getByBarcode()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  const provider = () => new UsdaProvider({ retryDelaysMs: [], maxQueueMs: 100 });

  it("reports a rate limit as such, with the advised delay", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({}, { status: 429, headers: { "retry-after": "45" } }),
    );

    await expect(provider().search("apple")).rejects.toMatchObject({
      name: "ProviderUnavailableError",
      reason: "RATE_LIMITED",
      retryAfterSeconds: 45,
      upstreamStatus: 429,
    });
  });

  it("does not retry a rejected key", async () => {
    // 403 from FDC means the key is missing, wrong or over quota. Retrying it
    // wastes the little quota that may be left.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, { status: 403 }));

    await expect(new UsdaProvider({ retryDelaysMs: [1, 1] }).search("apple")).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout as a timeout", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abort);

    await expect(provider().search("apple")).rejects.toMatchObject({ reason: "TIMEOUT" });
  });

  it("reports an unreachable host as a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOTFOUND"));

    await expect(provider().search("apple")).rejects.toMatchObject({ reason: "NETWORK" });
  });

  it("reports a malformed body rather than throwing a parse error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    await expect(provider().search("apple")).rejects.toMatchObject({ name: "ProviderUnavailableError" });
  });

  it("retries a server error and succeeds on the second attempt", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ foods: [searchHit] }));

    const results = await new UsdaProvider({ retryDelaysMs: [1] }).search("apple");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });
});
