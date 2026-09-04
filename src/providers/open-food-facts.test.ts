import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenFoodFactsProvider,
  resetOpenFoodFactsThrottle,
  userAgentLooksAnonymous,
  type OpenFoodFactsOptions,
} from "./open-food-facts";
import { ProviderUnavailableError } from "./food";

/** No retry backoff and an empty request schedule keep the suite instant. */
const provider = (options: OpenFoodFactsOptions = {}) =>
  new OpenFoodFactsProvider("https://example.test", "NutriCore test (dev@example.net)", true, {
    // No retry backoff and a pinned backend keep the suite instant and honest
    // about which endpoint each test exercises.
    retryDelaysMs: [],
    searchUrl: "https://search.example.test",
    ...options,
  });

/** The legacy CGI endpoint, which several tests still cover directly. */
const legacy = (options: OpenFoodFactsOptions = {}) => provider({ searchBackend: "legacy", ...options });

// A fresh Response per call: a body may only be read once.
const json = (body: unknown, status = 200) =>
  vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );

beforeEach(() => resetOpenFoodFactsThrottle());
afterEach(() => vi.unstubAllGlobals());

describe("Open Food Facts adapter", () => {
  it("normalizes nutrients and keeps unknown values null", async () => {
    vi.stubGlobal(
      "fetch",
      json({ status: 1, product: { code: "12345678", product_name: "Test", nutriments: { "energy-kcal_100g": 42 } } }),
    );
    const food = await provider().getByBarcode("12345678");
    expect(food?.nutrients).toMatchObject({ energyKcal: 42, protein: null, vitaminC: null });
    expect(food?.provenance.provider).toBe("OPEN_FOOD_FACTS");
    expect(food?.provenance.providerId).toBe("12345678");
  });

  it("sends a descriptive User-Agent and requests only the needed fields", async () => {
    const fetchMock = json({ status: 1, product: { code: "12345678", product_name: "Test", nutriments: {} } });
    vi.stubGlobal("fetch", fetchMock);
    await provider().getByBarcode("12345678");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v2/product/12345678.json?fields=");
    expect(init.headers["User-Agent"]).toBe("NutriCore test (dev@example.net)");
  });

  it("converts mineral and vitamin grams to mg and µg", async () => {
    vi.stubGlobal(
      "fetch",
      json({
        status: 1,
        product: { code: "12345678", product_name: "Test", nutriments: { calcium_100g: 0.12, "vitamin-d_100g": 0.0000025 } },
      }),
    );
    const food = await provider().getByBarcode("12345678");
    expect(food?.nutrients.calcium).toBeCloseTo(120);
    expect(food?.nutrients.vitaminD).toBeCloseTo(2.5);
  });

  it("derives the missing half of an energy or salt pair without overwriting a source value", async () => {
    vi.stubGlobal(
      "fetch",
      json({
        status: 1,
        product: { code: "12345678", product_name: "Test", nutriments: { "energy-kj_100g": 418.4, sodium_100g: 0.4 } },
      }),
    );
    const food = await provider().getByBarcode("12345678");
    expect(food?.nutrients.energyKcal).toBeCloseTo(100);
    expect(food?.nutrients.salt).toBeCloseTo(1);

    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      json({
        status: 1,
        product: {
          code: "12345678",
          product_name: "Test",
          nutriments: { "energy-kcal_100g": 90, "energy-kj_100g": 418.4, salt_100g: 3, sodium_100g: 0.4 },
        },
      }),
    );
    const preserved = await provider().getByBarcode("12345678");
    expect(preserved?.nutrients.energyKcal).toBe(90);
    expect(preserved?.nutrients.salt).toBe(3);
  });

  it("parses serving_size into an explicit amount and unit", async () => {
    vi.stubGlobal(
      "fetch",
      json({ status: 1, product: { code: "12345678", product_name: "Test", serving_size: "30 g", nutriments: {} } }),
    );
    const food = await provider().getByBarcode("12345678");
    expect(food?.servingAmount).toBe(30);
    expect(food?.servingUnit).toBe("g");
    expect(food?.servingLabel).toBe("30 g");
  });

  it("reads a density from a serving that states both a volume and a weight", async () => {
    // The only density OFF ever publishes. Without it a drink reaches the app
    // with none at all, and no recipe ingredient could be weighed from it.
    vi.stubGlobal(
      "fetch",
      json({ status: 1, product: { code: "12345678", product_name: "Saft", quantity: "1 l", serving_size: "200 ml (206 g)", nutriments: {} } }),
    );
    expect((await provider().getByBarcode("12345678"))?.densityGPerMl).toBeCloseTo(1.03);
  });

  it("states no density when the serving gives only one measure", async () => {
    vi.stubGlobal(
      "fetch",
      json({ status: 1, product: { code: "12345678", product_name: "Saft", quantity: "1 l", serving_size: "200 ml", nutriments: {} } }),
    );
    expect((await provider().getByBarcode("12345678"))?.densityGPerMl).toBeUndefined();
  });

  it("uses a millilitre basis for drinks", async () => {
    vi.stubGlobal(
      "fetch",
      json({ status: 1, product: { code: "12345678", product_name: "Juice", quantity: "1 l", nutriments: {} } }),
    );
    expect((await provider().getByBarcode("12345678"))?.basisUnit).toBe("ML");
  });

  it("does not call the API for invalid barcodes", async () => {
    const fetchMock = json({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().getByBarcode("oops")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a missing product as null, not as an outage", async () => {
    vi.stubGlobal("fetch", json({ status: 0 }, 404));
    await expect(provider().getByBarcode("12345678")).resolves.toBeNull();
  });

  it("raises a typed error when the service is down", async () => {
    vi.stubGlobal("fetch", json({}, 503));
    await expect(provider().getByBarcode("12345678")).rejects.toBeInstanceOf(ProviderUnavailableError);

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(provider().getByBarcode("12345678")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("searches by free text rather than by category tag", async () => {
    const fetchMock = json({ products: [{ code: "1", product_name: "Skyr", nutriments: {} }] });
    vi.stubGlobal("fetch", fetchMock);
    const results = await legacy().search("skyr natur");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("search_terms=skyr+natur");
    expect(url).not.toContain("categories_tags");
    expect(results).toHaveLength(1);
  });

  it("uses the documented search mode, popularity ranking, locale, and limits above 25", async () => {
    const fetchMock = json({ products: [] });
    vi.stubGlobal("fetch", fetchMock);
    await legacy().search("milka alpenmilch", { limit: 40, locale: "de" });

    const [rawUrl] = fetchMock.mock.calls[0];
    const url = new URL(rawUrl);
    expect(url.searchParams.get("search_simple")).toBe("1");
    expect(url.searchParams.get("action")).toBe("process");
    expect(url.searchParams.get("sort_by")).toBe("unique_scans_n");
    expect(url.searchParams.get("lc")).toBe("de");
    expect(url.searchParams.get("cc")).toBeNull();
    expect(url.searchParams.get("page_size")).toBe("40");
  });

  it("identifies rate limits, timeouts, and other outages", async () => {
    vi.stubGlobal("fetch", json({}, 429));
    await expect(legacy().search("milka")).rejects.toMatchObject({
      name: "ProviderUnavailableError",
      reason: "RATE_LIMITED",
    });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "AbortError")));
    await expect(legacy().search("milka")).rejects.toMatchObject({ reason: "TIMEOUT" });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", json({}, 503));
    await expect(legacy().search("milka")).rejects.toMatchObject({ reason: "HTTP_ERROR", upstreamStatus: 503 });
  });

  it("preserves Retry-After from a rate-limited response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "42" } })));
    await expect(legacy().search("milka")).rejects.toMatchObject({ reason: "RATE_LIMITED", retryAfterSeconds: 42 });
  });

  it("gives searches a longer timeout than barcode lookups", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ products: [] }), { headers: { "Content-Type": "application/json" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const customProvider = provider({ barcodeTimeoutMs: 1234, searchTimeoutMs: 5678 });

    await customProvider.getByBarcode("12345678");
    await customProvider.search("milka");

    expect(timeout).toHaveBeenNthCalledWith(1, 1234);
    expect(timeout).toHaveBeenNthCalledWith(2, 5678);
  });

  it("does not query the API for very short terms", async () => {
    const fetchMock = json({ products: [] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(legacy().search("ei")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retries a transient upstream failure and returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ products: [{ code: "1", product_name: "Skyr", nutriments: {} }] })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(legacy({ retryDelaysMs: [0] }).search("skyr")).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured attempts and reports the last failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(legacy({ retryDelaysMs: [0, 0] }).search("skyr")).rejects.toMatchObject({ reason: "HTTP_ERROR", upstreamStatus: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a rejection the provider will repeat", async () => {
    // 403 is a blocked User-Agent: a second identical request cannot help.
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(legacy({ retryDelaysMs: [0] }).search("skyr")).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when the provider asks for longer than a request may wait", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "600" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(legacy({ retryDelaysMs: [0] }).search("skyr")).rejects.toMatchObject({ reason: "RATE_LIMITED", retryAfterSeconds: 600 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not delay a normal run of searches", async () => {
    const fetchMock = json({ products: [] });
    vi.stubGlobal("fetch", fetchMock);
    const paced = provider();

    // Several searches in a row are the normal case, not a burst to throttle.
    for (let i = 0; i < 5; i += 1) await paced.search(`skyr ${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("waits for a slot rather than earning a 429 upstream", async () => {
    const fetchMock = json({ products: [] });
    vi.stubGlobal("fetch", fetchMock);
    const paced = legacy();
    for (let i = 0; i < 5; i += 1) await paced.search(`skyr ${i}`);

    vi.useFakeTimers();
    try {
      const pending = paced.search("skyr sechs");
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(5);

      // One slot per ~6.7s at the paced rate: the request is held, not failed.
      await vi.advanceTimersByTimeAsync(7000);
      await expect(pending).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast instead of holding a request open beyond its queue budget", async () => {
    const fetchMock = json({ products: [] });
    vi.stubGlobal("fetch", fetchMock);
    const paced = legacy();
    for (let i = 0; i < 5; i += 1) await paced.search(`skyr ${i}`);

    await expect(legacy({ maxQueueMs: 0 }).search("skyr sieben")).rejects.toMatchObject({ reason: "RATE_LIMITED" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("searches the Elasticsearch service by default and marks hits partial", async () => {
    const fetchMock = json({
      hits: [
        {
          code: "4000000000001",
          product_name: "Milchreis",
          product_name_de: "Müller Milchreis Original",
          brands: ["Müller"],
          nutriments: { "energy-kcal_100g": 130, proteins_100g: 3.7 },
          nova_group: "4",
          last_modified_t: "2026-07-01T00:00:00Z",
        },
      ],
      count: 1,
    });
    vi.stubGlobal("fetch", fetchMock);

    const [food] = await provider().search("milchreis", { limit: 25, locale: "de" });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin).toBe("https://search.example.test");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("milchreis");
    expect(url.searchParams.get("page_size")).toBe("25");
    // List parameters are comma-separated, not repeated.
    expect(url.searchParams.get("langs")).toBe("de,en");

    // The index carries macronutrients only, so the hit must not be trusted
    // to speak for the nutrients it does not mention.
    expect(food.partial).toBe(true);
    expect(food.nutrients.energyKcal).toBe(130);
    expect(food.nutrients.protein).toBe(3.7);
    expect(food.nutrients.calcium).toBeNull();
  });

  it("reads the shapes the search index differs on", async () => {
    vi.stubGlobal(
      "fetch",
      json({
        hits: [
          {
            code: "4000000000001",
            product_name: "Milchreis",
            product_name_de: "Müller Milchreis Original",
            brands: ["Müller", "Müller Milch"],
            nutriments: {},
            nova_group: "4",
            last_modified_t: "2026-07-01T00:00:00Z",
          },
        ],
      }),
    );

    const [food] = await provider().search("milchreis", { locale: "de" });
    // The localised name wins over the product's own language.
    expect(food.name).toBe("Müller Milchreis Original");
    // Brands arrive as a taxonomy list here and a joined string over REST.
    expect(food.brand).toBe("Müller, Müller Milch");
    // A keyword in the index, a number over REST.
    expect((food.raw as { novaGroup: number }).novaGroup).toBe(4);
    // An ISO date in the index, a unix timestamp over REST.
    expect(food.provenance.providerUpdatedAt).toEqual(new Date("2026-07-01T00:00:00Z"));
  });

  it("falls back to the legacy endpoint when the search service is down", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ products: [{ code: "1", product_name: "Skyr", nutriments: {} }] })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider().search("skyr");

    expect(results).toHaveLength(1);
    // A legacy answer is complete, so it must not be marked partial.
    expect(results[0].partial).toBeUndefined();
    expect(new URL(fetchMock.mock.calls[0][0]).origin).toBe("https://search.example.test");
    expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe("/cgi/search.pl");
  });

  it("reports the primary backend's failure when the fallback fails too", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().search("skyr")).rejects.toMatchObject({ upstreamStatus: 500 });
  });

  it("honours a pinned legacy backend without calling the search service", async () => {
    const fetchMock = json({ products: [] });
    vi.stubGlobal("fetch", fetchMock);

    await legacy().search("skyr");

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe("/cgi/search.pl");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recognizes a User-Agent that Open Food Facts cannot attribute", () => {
    expect(userAgentLooksAnonymous("NutriCore/0.1 (self-hosted)")).toBe(true);
    expect(userAgentLooksAnonymous("NutriCore/0.1 (admin@example.invalid)")).toBe(true);
    expect(userAgentLooksAnonymous("NutriCore/0.1")).toBe(true);
    expect(userAgentLooksAnonymous("NutriCore/0.1 (maxi@nutricore.test)")).toBe(false);
  });
});
