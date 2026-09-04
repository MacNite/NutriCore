import { describe, expect, it } from "vitest";
import { estimatedDensityGPerMl, WATER_LIKE_DENSITY } from "./density";

describe("the density assumed for a food sold by volume", () => {
  it("reads the compound German names these products are actually sold under", () => {
    expect(estimatedDensityGPerMl("Bio Rapsöl kaltgepresst")).toBe(0.92);
    expect(estimatedDensityGPerMl("Naturtrüber Apfelsaft")).toBe(1.04);
    expect(estimatedDensityGPerMl("Gemüsebrühe klar")).toBe(1);
    expect(estimatedDensityGPerMl("Frische Vollmilch 3,5%")).toBe(1.03);
  });

  it("catches an oil it does not name individually", () => {
    // The bare "öl" is what keeps every unlisted oil off the water-like default,
    // which is the one common liquid that default gets meaningfully wrong.
    expect(estimatedDensityGPerMl("Kürbiskernöl")).toBe(0.92);
    expect(estimatedDensityGPerMl("Olive oil, extra virgin")).toBe(0.92);
  });

  it("falls back to water for a liquid it cannot place", () => {
    expect(estimatedDensityGPerMl("Hausmarke Getränk")).toBe(WATER_LIKE_DENSITY);
  });

  it("does not read a brand as the food it contains", () => {
    // "Ölmühle" is a producer, not an oil, and matching inside a word would
    // have made every one of its products 0.92.
    expect(estimatedDensityGPerMl("Ölmühle Solling Limonade")).toBe(1);
  });
});
