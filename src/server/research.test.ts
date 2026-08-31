import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateReferenceUrl } from "./research";

vi.mock("@/lib/db", () => ({ prisma: {} }));

/** `env()` caches its parse, so each case needs a fresh module graph. */
async function load(values: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("APP_SECRET", "x".repeat(32));
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  return import("./research");
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe("research source storage validation", () => {
  it("accepts http(s) references without DNS and rejects unsafe syntax", () => {
    expect(validateReferenceUrl("https://example.org/recipe")).toBe("https://example.org/recipe");
    expect(validateReferenceUrl("javascript:alert(1)")).toBeNull();
    expect(validateReferenceUrl("https://user:secret@example.org")).toBeNull();
  });
});

describe("availability", () => {
  const user = { aiEnabled: true, researchEnabled: false };

  it("offers AI research on an AI-configured server without the web-research flag", async () => {
    // Estimating from the model alone sends nothing to the web, so RESEARCH_ENABLED
    // must not decide whether AI search exists at all.
    const { researchAvailability } = await load({ AI_ENABLED: "true", RESEARCH_ENABLED: "false" });
    expect(researchAvailability(user).available).toBe(true);
  });

  it("reports the server when AI is switched off there", async () => {
    const { researchAvailability } = await load({ AI_ENABLED: "false" });
    expect(researchAvailability(user)).toEqual({ available: false, reason: "SERVER_DISABLED" });
  });

  it("names the user's own switch when they turned AI off", async () => {
    const { researchAvailability } = await load({ AI_ENABLED: "true" });
    expect(researchAvailability({ ...user, aiEnabled: false })).toEqual({ available: false, reason: "AI_DISABLED" });
  });

  it("keeps web sources behind both the server flag and consent", async () => {
    const enabled = await load({ AI_ENABLED: "true", RESEARCH_ENABLED: "true" });
    expect(enabled.webSourcesAvailable({ researchEnabled: true })).toBe(true);
    expect(enabled.webSourcesAvailable({ researchEnabled: false })).toBe(false);

    const off = await load({ AI_ENABLED: "true", RESEARCH_ENABLED: "false" });
    expect(off.webSourcesAvailable({ researchEnabled: true })).toBe(false);
  });
});
