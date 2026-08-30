import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFoodFactsProvider } from "./open-food-facts";
import { ProviderUnavailableError } from "./food";

const provider = () => new OpenFoodFactsProvider("https://example.test", "NutriCore test");

const json = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

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
    expect(init.headers["User-Agent"]).toBe("NutriCore test");
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
    const results = await provider().search("skyr natur");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("search_terms=skyr+natur");
    expect(url).not.toContain("categories_tags");
    expect(results).toHaveLength(1);
  });

  it("does not query the API for very short terms", async () => {
    const fetchMock = json({ products: [] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().search("ei")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
