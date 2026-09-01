import { describe, expect, it } from "vitest";
import sharp from "sharp";

describe("PWA icons", () => {
  it("keeps the maskable icon background solid through Android's safe area", async () => {
    const image = sharp("public/icon-maskable-512.png");
    const metadata = await image.metadata();
    const pixels = await image.raw().toBuffer();

    expect(metadata).toMatchObject({ width: 512, height: 512, channels: 4 });

    const pixelAt = (x: number, y: number) => {
      const offset = (y * 512 + x) * 4;
      return [...pixels.subarray(offset, offset + 4)];
    };

    // Maskable icons must fill the complete canvas because launchers apply their
    // own shape. Transparent padding would appear as white corner decorations.
    expect(pixelAt(0, 0)).toEqual([36, 107, 75, 255]);
    expect(pixelAt(511, 0)).toEqual([36, 107, 75, 255]);
    expect(pixelAt(0, 511)).toEqual([36, 107, 75, 255]);
    expect(pixelAt(511, 511)).toEqual([36, 107, 75, 255]);
  });
});
