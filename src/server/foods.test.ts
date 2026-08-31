import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchQueryCache } = vi.hoisted(() => ({
  searchQueryCache: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { searchQueryCache },
}));

import { OpenFoodFactsProvider } from "@/providers/open-food-facts";
import { fetchRemote } from "./foods";

describe("remote food search cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchQueryCache.findUnique.mockResolvedValue(null);
  });

  it("does not cache an empty provider result", async () => {
    const search = vi.spyOn(OpenFoodFactsProvider.prototype, "search").mockResolvedValue([]);

    await expect(fetchRemote("unknown product", null, "de")).resolves.toEqual([]);

    expect(search).toHaveBeenCalledWith("unknown product", { limit: 25, locale: "de" });
    expect(searchQueryCache.upsert).not.toHaveBeenCalled();
  });
});
