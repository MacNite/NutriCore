import { describe, expect, it } from "vitest";
import { imageUploadMaxBytes, imageUploadMaxMb } from "./image-upload-limit";

describe("image upload limit", () => {
  it("defaults to 5 MiB", () => {
    expect(imageUploadMaxMb(undefined)).toBe(5);
    expect(imageUploadMaxBytes(undefined)).toBe(5 * 1024 * 1024);
  });

  it("accepts a configured whole number of MiB", () => {
    expect(imageUploadMaxMb("12")).toBe(12);
    expect(imageUploadMaxBytes("12")).toBe(12 * 1024 * 1024);
  });

  it.each(["0", "-1", "1.5", "nope", "51"])("falls back for invalid value %s", (value) => {
    expect(imageUploadMaxMb(value)).toBe(5);
  });
});
