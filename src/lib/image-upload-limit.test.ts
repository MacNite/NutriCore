import { describe, expect, it } from "vitest";
import { MAX_CONFIGURED_IMAGE_UPLOAD_MB, imageUploadMaxBytes, imageUploadMaxMb, requestBodyLimitMb } from "./image-upload-limit";

describe("image upload limit", () => {
  it("defaults to 5 MiB", () => {
    expect(imageUploadMaxMb(undefined)).toBe(5);
    expect(imageUploadMaxBytes(undefined)).toBe(5 * 1024 * 1024);
  });

  it("accepts a configured whole number of MiB", () => {
    expect(imageUploadMaxMb("12")).toBe(12);
    expect(imageUploadMaxBytes("12")).toBe(12 * 1024 * 1024);
  });

  it.each(["0", "-1", "1.5", "nope"])("falls back to the default for unusable value %s", (value) => {
    expect(imageUploadMaxMb(value)).toBe(5);
  });

  it("clamps a value above the ceiling instead of dropping to the default", () => {
    // The intent is clear and only the amount is refused. Handing a deployment
    // that asked for 50 the 5 MiB default would be a worse answer than 15.
    expect(imageUploadMaxMb("50")).toBe(MAX_CONFIGURED_IMAGE_UPLOAD_MB);
  });

  it("is capped at the limit the build's request ceilings were sized for", () => {
    // The published image is built with the default. A runtime value above it
    // used to let a photograph through unshrunk that the 11 MB ceiling then cut
    // in half, which surfaced as the generic error page.
    expect(imageUploadMaxMb("15", "5")).toBe(5);
    expect(imageUploadMaxBytes("15")).toBe(15 * 1024 * 1024);
  });

  it("still honours a runtime value below the built one", () => {
    expect(imageUploadMaxMb("3", "5")).toBe(3);
    expect(imageUploadMaxMb("12", "15")).toBe(12);
  });

  it("is not capped where there is no build to stay under", () => {
    expect(imageUploadMaxMb("12", undefined)).toBe(12);
    expect(imageUploadMaxMb("12", "")).toBe(12);
  });
});

describe("request body limit", () => {
  it("covers two images plus multipart overhead", () => {
    // A body scan is the largest request the application makes: front and side.
    expect(requestBodyLimitMb("5")).toBe(11);
    expect(requestBodyLimitMb(undefined)).toBe(11);
  });

  it("stays bounded by the configured ceiling", () => {
    // This is what Next applies to every Server Action, including the
    // unauthenticated ones, so it must not be open-ended.
    expect(requestBodyLimitMb("999")).toBe(MAX_CONFIGURED_IMAGE_UPLOAD_MB * 2 + 1);
  });
});
