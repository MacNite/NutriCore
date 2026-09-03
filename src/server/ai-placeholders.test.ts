import { beforeEach, describe, expect, it, vi } from "vitest";
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { aiJob: { findMany } } }));
import { mealPlaceholders, recipePlaceholders } from "./ai-placeholders";
beforeEach(() => findMany.mockReset());
describe("intent placeholders", () => {
  it("queries meal placeholders by stored intent", async () => { findMany.mockResolvedValue([]); await mealPlaceholders("u", "2026-09-03"); expect(findMany.mock.calls[0][0].where).toMatchObject({ entityType: "AI_INGESTION", ingestionInput: { intent: "MEAL" } }); });
  it("shows recipe runs only in recipes", async () => { findMany.mockResolvedValue([{ id: "j", status: "RUNNING", entityId: "i", ingestionInput: { intent: "RECIPE", text: "Soup", sourceUrl: null } }]); await expect(recipePlaceholders("u")).resolves.toEqual([{ id: "j", status: "RUNNING", href: "/recipes/new?import=i", source: "Soup" }]); });
});
