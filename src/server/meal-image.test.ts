import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { mealInput: { updateMany } } }));

import { cleanupExpiredMealImages, discardMealInputImage, hasMealInput, MEAL_IMAGE_MAX_BYTES, validateMealImage } from "./meal-image";

const png = (size = 8) => new File(
  [Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(Math.max(0, size - 8))])],
  "anything.exe",
  { type: "image/png" },
);

describe("quick meal image validation", () => {
  it.each([
    ["text only", "two eggs", "", null, true],
    ["image only", "", "", { mime: "image/png", data: Buffer.alloc(1), expiresAt: new Date() }, true],
    ["text and image", "two eggs", "", { mime: "image/png", data: Buffer.alloc(1), expiresAt: new Date() }, true],
    ["URL only", "", "https://example.test", null, true],
    ["empty input", "  ", " ", null, false],
  ] as const)("recognizes %s", (_label, text, url, image, expected) => {
    expect(hasMealInput(text, url, image)).toBe(expected);
  });
  it("accepts no image for text-only input", async () => expect(validateMealImage(null)).resolves.toBeNull());
  // An unselected file input reaches the action as a zero-byte part whose filename
  // the transport has already lost: "undefined" through React's busboy decoding of
  // a server action, "" through a plain multipart POST, "blob" for a nameless Blob.
  it.each(["undefined", "", "blob"])(
    "accepts the unselected file input a browser submits as %j",
    async (name) => expect(validateMealImage(new File([], name, { type: "application/octet-stream" }))).resolves.toBeNull(),
  );
  it("accepts a PNG by its bytes rather than filename", async () => expect((await validateMealImage(png()))?.mime).toBe("image/png"));
  it("rejects zero-byte images", async () => expect(validateMealImage(new File([], "x.png", { type: "image/png" }))).rejects.toThrow("imageEmpty"));
  it("rejects an invalid MIME type", async () => expect(validateMealImage(new File(["hello"], "x.txt", { type: "text/plain" }))).rejects.toThrow("imageInvalid"));
  it("rejects a spoofed allowed MIME type", async () => expect(validateMealImage(new File(["hello"], "x.png", { type: "image/png" }))).rejects.toThrow("imageInvalid"));
  it("rejects an oversized image before reading it", async () => expect(validateMealImage(png(MEAL_IMAGE_MAX_BYTES + 1))).rejects.toThrow("imageTooLarge"));
});

describe("quick meal image lifecycle", () => {
  beforeEach(() => updateMany.mockReset().mockResolvedValue({ count: 1 }));
  it("clears every transient field on terminal cleanup", async () => {
    await discardMealInputImage("meal-1");
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ["meal-1"] } }, data: { imageData: null, imageMime: null, imageExpiresAt: null } });
  });
  it("clears only expired image payloads in TTL maintenance", async () => {
    const now = new Date();
    await expect(cleanupExpiredMealImages(now)).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { imageData: { not: null }, imageExpiresAt: { lte: now } } }));
  });
});
