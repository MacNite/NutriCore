import { describe, expect, it } from "vitest";
import { SHRINK_STEPS, fitWithin, jpegName } from "./shrink-image";

describe("fitting an image to a long edge", () => {
  it("scales a landscape photograph by its width", () => {
    expect(fitWithin(6000, 4500, 2048)).toEqual({ width: 2048, height: 1536 });
  });

  it("scales a portrait photograph by its height", () => {
    expect(fitWithin(4500, 6000, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  it("leaves an image that already fits alone", () => {
    // A small file over the limit is over it because of how it was encoded, and
    // enlarging it to meet the step would make it larger still.
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  it("never rounds a very wide panorama down to nothing", () => {
    expect(fitWithin(20_000, 400, 1024).height).toBeGreaterThanOrEqual(1);
  });

  it("survives a degenerate size rather than dividing by zero", () => {
    expect(fitWithin(0, 0, 2048)).toEqual({ width: 0, height: 0 });
  });
});

describe("the shrink ladder", () => {
  it("only ever gets smaller, so a later step cannot undo an earlier one", () => {
    const edges = SHRINK_STEPS.map((step) => step.maxEdge);
    expect([...edges].sort((a, b) => b - a)).toEqual([...edges]);
    const qualities = SHRINK_STEPS.map((step) => step.quality);
    expect([...qualities].sort((a, b) => b - a)).toEqual([...qualities]);
  });
});

describe("naming the shrunk file", () => {
  it("replaces the extension, because the result is always a JPEG", () => {
    expect(jpegName("rezept.HEIC")).toBe("rezept.jpg");
    expect(jpegName("scan.png")).toBe("scan.jpg");
  });

  it("keeps a name with dots in it", () => {
    expect(jpegName("2026.09.15 Pfannkuchen.jpeg")).toBe("2026.09.15 Pfannkuchen.jpg");
  });

  it("never produces an empty name, which the server reads as no file at all", () => {
    expect(jpegName("")).toBe("foto.jpg");
    expect(jpegName(".jpg")).toBe("foto.jpg");
  });
});
