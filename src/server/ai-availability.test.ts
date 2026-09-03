import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (aiEnabled?: string) => {
  vi.resetModules();
  if (aiEnabled === undefined) delete process.env.AI_ENABLED;
  else process.env.AI_ENABLED = aiEnabled;
  return (await import("./ai-availability")).aiAvailable;
};

afterEach(() => {
  delete process.env.AI_ENABLED;
});

describe("aiAvailable", () => {
  it("is true when the deployment allows it and the user has not opted out", async () => {
    const aiAvailable = await load("true");
    expect(aiAvailable({ aiEnabled: true })).toBe(true);
  });

  it("defaults to on, the way the configuration schema does", async () => {
    const aiAvailable = await load();
    expect(aiAvailable({ aiEnabled: true })).toBe(true);
  });

  it("honours the user's own switch, which the quick meal used to ignore", async () => {
    const aiAvailable = await load("true");
    expect(aiAvailable({ aiEnabled: false })).toBe(false);
  });

  it("honours the deployment switch", async () => {
    const aiAvailable = await load("false");
    expect(aiAvailable({ aiEnabled: true })).toBe(false);
  });

  it("reads the deployment switch as the schema does, not just the word 'false'", async () => {
    // `AI_ENABLED=0` used to leave the recipe import enabled while every other
    // reading of the flag treated it as off.
    const aiAvailable = await load("0");
    expect(aiAvailable({ aiEnabled: true })).toBe(false);
  });
});
