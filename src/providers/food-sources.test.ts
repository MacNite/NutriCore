/**
 * The food source registry: what order sources are consulted in, which ones a
 * given configuration includes, and what each is allowed to keep.
 *
 * These are configuration tests on purpose. The tier model is the feature, and
 * it should be readable and checkable without a database, a network or a mock.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  BARCODE_ORDER,
  FOOD_SOURCES,
  TEXT_SEARCH_ORDER,
  barcodeTiers,
  cacheExpiryFor,
  textSearchOrder,
  textSearchTiers,
} from "./food-sources";

const ENV_KEYS = ["BLS_ENABLED", "USDA_ENABLED", "OPENFOODFACTS_ENABLED", "FATSECRET_ENABLED", "USDA_API_KEY", "FATSECRET_CLIENT_ID", "FATSECRET_CLIENT_SECRET"] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

const ids = (sources: { id: string }[]) => sources.map((source) => source.id);

/**
 * Turns every source on, so a test about tier *order* is not also a test about
 * this machine's configuration. FatSecret is off by default, which is exactly
 * what the "only enabled sources take part" tests below rely on.
 */
function enableEverySource() {
  process.env.BLS_ENABLED = "true";
  process.env.USDA_ENABLED = "true";
  process.env.OPENFOODFACTS_ENABLED = "true";
  process.env.FATSECRET_ENABLED = "true";
  process.env.FATSECRET_CLIENT_ID = "test-id";
  process.env.FATSECRET_CLIENT_SECRET = "test-secret";
}

describe("text search order", () => {
  it("puts BLS before the internet for German", () => {
    expect(TEXT_SEARCH_ORDER.de).toEqual(["LOCAL", "BLS", "OPEN_FOOD_FACTS", "FATSECRET", "USDA"]);
  });

  it("puts USDA in that place for English", () => {
    expect(TEXT_SEARCH_ORDER.en).toEqual(["LOCAL", "USDA", "OPEN_FOOD_FACTS", "FATSECRET"]);
  });

  it("consults every enabled German tier in the documented order", () => {
    enableEverySource();
    expect(ids(textSearchTiers("de"))).toEqual(["LOCAL", "BLS", "OPEN_FOOD_FACTS", "FATSECRET", "USDA"]);
    expect(ids(textSearchTiers("en"))).toEqual(["LOCAL", "USDA", "OPEN_FOOD_FACTS", "FATSECRET"]);
  });

  it("always looks locally first", () => {
    for (const order of Object.values(TEXT_SEARCH_ORDER)) expect(order[0]).toBe("LOCAL");
  });

  it("falls back to the German order for a locale it does not know", () => {
    expect(textSearchOrder("fr" as "de")).toEqual(TEXT_SEARCH_ORDER.de);
  });
});

describe("barcode order", () => {
  it("goes local, then Open Food Facts, then FatSecret", () => {
    expect(BARCODE_ORDER).toEqual(["LOCAL", "OPEN_FOOD_FACTS", "FATSECRET"]);
  });

  it("never includes a generic ingredient database", () => {
    // BLS and the USDA generic releases hold no barcodes at all, so asking
    // them for one is a guaranteed miss that costs a scan latency.
    expect(BARCODE_ORDER).not.toContain("BLS");
    expect(BARCODE_ORDER).not.toContain("USDA");
    expect(FOOD_SOURCES.BLS.capabilities.barcode).toBe(false);
    expect(FOOD_SOURCES.USDA.capabilities.barcode).toBe(false);
  });

  it("includes FatSecret in the barcode tiers only when it is enabled", () => {
    enableEverySource();
    expect(ids(barcodeTiers())).toEqual(["LOCAL", "OPEN_FOOD_FACTS", "FATSECRET"]);
    process.env.FATSECRET_ENABLED = "false";
    expect(ids(barcodeTiers())).toEqual(["LOCAL", "OPEN_FOOD_FACTS"]);
  });
});

describe("only enabled sources take part", () => {
  it("skips BLS when it is turned off", () => {
    enableEverySource();
    process.env.BLS_ENABLED = "false";
    expect(ids(textSearchTiers("de"))).toEqual(["LOCAL", "OPEN_FOOD_FACTS", "FATSECRET", "USDA"]);
  });

  it("skips USDA when it is turned off", () => {
    enableEverySource();
    process.env.USDA_ENABLED = "false";
    expect(ids(textSearchTiers("en"))).toEqual(["LOCAL", "OPEN_FOOD_FACTS", "FATSECRET"]);
  });

  it("skips Open Food Facts when it is turned off", () => {
    enableEverySource();
    process.env.OPENFOODFACTS_ENABLED = "false";
    expect(ids(textSearchTiers("de"))).not.toContain("OPEN_FOOD_FACTS");
  });

  it("leaves only the local tiers when every network source is off", () => {
    enableEverySource();
    process.env.OPENFOODFACTS_ENABLED = "false";
    process.env.FATSECRET_ENABLED = "false";
    process.env.USDA_ENABLED = "false";
    expect(ids(textSearchTiers("de"))).toEqual(["LOCAL", "BLS"]);
  });

  it("enables BLS and USDA by default, because both are bundled", () => {
    delete process.env.BLS_ENABLED;
    delete process.env.USDA_ENABLED;
    expect(FOOD_SOURCES.BLS.isEnabled()).toBe(true);
    expect(FOOD_SOURCES.USDA.isEnabled()).toBe(true);
  });

  it("leaves FatSecret off by default", () => {
    delete process.env.FATSECRET_ENABLED;
    expect(FOOD_SOURCES.FATSECRET.isEnabled()).toBe(false);
  });
});

describe("a source's network half is configured separately from the source", () => {
  it("keeps USDA usable from the bundled data with no API key", () => {
    process.env.USDA_ENABLED = "true";
    delete process.env.USDA_API_KEY;
    // The source still participates - the bundled releases answer locally -
    // but the API half reports itself unconfigured and is not called.
    expect(FOOD_SOURCES.USDA.isEnabled()).toBe(true);
    expect(FOOD_SOURCES.USDA.isNetworkConfigured()).toBe(false);
    expect(FOOD_SOURCES.USDA.stored).not.toBeNull();
  });

  it("treats USDA's API as configured once a key is present", () => {
    process.env.USDA_ENABLED = "true";
    process.env.USDA_API_KEY = "test-key";
    expect(FOOD_SOURCES.USDA.isNetworkConfigured()).toBe(true);
  });

  it("does not consider FatSecret configured without credentials", () => {
    process.env.FATSECRET_ENABLED = "true";
    delete process.env.FATSECRET_CLIENT_ID;
    delete process.env.FATSECRET_CLIENT_SECRET;
    expect(FOOD_SOURCES.FATSECRET.isNetworkConfigured()).toBe(false);
  });

  it("has nothing stored for a purely remote source", () => {
    expect(FOOD_SOURCES.OPEN_FOOD_FACTS.stored).toBeNull();
    expect(FOOD_SOURCES.FATSECRET.stored).toBeNull();
  });

  it("needs no network for the bundled databases", () => {
    expect(FOOD_SOURCES.BLS.network).toBe(false);
    expect(FOOD_SOURCES.LOCAL.network).toBe(false);
  });
});

describe("persistence policy", () => {
  it("keeps the open and public databases permanently", () => {
    expect(FOOD_SOURCES.BLS.cache.persistence).toBe("PERMANENT");
    expect(FOOD_SOURCES.USDA.cache.persistence).toBe("PERMANENT");
    expect(FOOD_SOURCES.OPEN_FOOD_FACTS.cache.persistence).toBe("PERMANENT");
    expect(cacheExpiryFor(FOOD_SOURCES.OPEN_FOOD_FACTS)).toBeNull();
  });

  it("only caches FatSecret, and stamps an expiry on what it stores", () => {
    // Its terms allow using the data, not accumulating a copy of the database.
    expect(FOOD_SOURCES.FATSECRET.cache.persistence).toBe("CACHE_WITH_TTL");
    const now = Date.UTC(2026, 0, 1);
    const expiry = cacheExpiryFor(FOOD_SOURCES.FATSECRET, now);
    expect(expiry).not.toBeNull();
    expect(expiry!.getTime()).toBe(now + FOOD_SOURCES.FATSECRET.cache.contentTtlMs);
  });

  it("serves a stale answer during an outage only where that is allowed", () => {
    expect(FOOD_SOURCES.OPEN_FOOD_FACTS.cache.serveStaleOnOutage).toBe(true);
    expect(FOOD_SOURCES.USDA.cache.serveStaleOnOutage).toBe(true);
    expect(FOOD_SOURCES.FATSECRET.cache.serveStaleOnOutage).toBe(false);
  });

  it("gives Open Food Facts the TTLs it has always had", () => {
    // A day for a search answer, a week for the product itself. Changing these
    // would be a silent behaviour change for every existing installation.
    expect(FOOD_SOURCES.OPEN_FOOD_FACTS.cache.searchTtlMs).toBe(24 * 60 * 60 * 1000);
    expect(FOOD_SOURCES.OPEN_FOOD_FACTS.cache.contentTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
