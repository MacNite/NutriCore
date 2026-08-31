import { afterEach, describe, expect, it, vi } from "vitest";
import { SearxngClient, sanitizeSearchQuery } from "./searxng";

describe("SearXNG adapter", () => {
  afterEach(() => vi.restoreAllMocks());
  it("sanitizes control characters and requests JSON", async () => {
    const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({results:[{title:"USDA",url:"https://example.test/food",content:"facts"}]}),{status:200}));
    const result=await new SearxngClient("https://search.test",100).search("banana\u0000 <facts>");
    expect(result).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("format=json");
    expect(sanitizeSearchQuery("a\u0000  b")).toBe("a b");
  });
  it("fails cleanly after one retry", async () => {
    vi.spyOn(globalThis,"fetch").mockRejectedValue(new DOMException("timeout","AbortError"));
    await expect(new SearxngClient("https://search.test",1).search("banana nutrition")).rejects.toThrow("Nutrition source search unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
