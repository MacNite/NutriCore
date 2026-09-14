import { describe, expect, it } from "vitest";
import { MAX_IMPORT_SAMPLES } from "@/lib/health-import";
import { parseSamples } from "./health-import-ingest";

/**
 * The device endpoint and the settings-page action share this validation, so
 * these are the rules a phone is held to as much as the browser is.
 */

const sample = (over: Record<string, unknown> = {}) => ({
  metric: "weightKg",
  date: "2026-09-05",
  recordedAt: "2026-09-05T07:14:00.000Z",
  value: 82.4,
  externalId: "abc-123",
  source: "Withings",
  ...over,
});

describe("sample payload validation", () => {
  it("accepts a well-formed sample", () => {
    const parsed = parseSamples([sample()]);
    expect(parsed).toEqual({ ok: true, samples: [sample()] });
  });

  it("accepts a null source, which Apple exports routinely omit", () => {
    expect(parseSamples([sample({ source: null })]).ok).toBe(true);
  });

  it("refuses an empty array separately from a malformed one", () => {
    expect(parseSamples([])).toEqual({ ok: false, error: "empty" });
    expect(parseSamples("nope")).toEqual({ ok: false, error: "validation" });
    expect(parseSamples(undefined)).toEqual({ ok: false, error: "validation" });
  });

  it("refuses a value outside the plausible range for its metric", () => {
    // 0 kg is what a scale reports during a firmware fault.
    expect(parseSamples([sample({ value: 0 })]).ok).toBe(false);
    expect(parseSamples([sample({ value: 500 })]).ok).toBe(false);
    // The same number is fine for a metric whose range contains it.
    expect(parseSamples([sample({ metric: "heightCm", value: 180 })]).ok).toBe(true);
    expect(parseSamples([sample({ metric: "bodyFatPct", value: 180 })]).ok).toBe(false);
  });

  it("refuses a metric it cannot store", () => {
    expect(parseSamples([sample({ metric: "heartRate" })]).ok).toBe(false);
    expect(parseSamples([sample({ metric: "muscleKg" })]).ok).toBe(false);
  });

  it("refuses a date that is not a plain day key", () => {
    expect(parseSamples([sample({ date: "2026-9-5" })]).ok).toBe(false);
    expect(parseSamples([sample({ date: "2026-09-05T00:00:00Z" })]).ok).toBe(false);
    expect(parseSamples([sample({ recordedAt: "2026-09-05" })]).ok).toBe(false);
  });

  it("refuses a non-finite value however it is spelled", () => {
    expect(parseSamples([sample({ value: Number.NaN })]).ok).toBe(false);
    expect(parseSamples([sample({ value: Number.POSITIVE_INFINITY })]).ok).toBe(false);
    expect(parseSamples([sample({ value: "82.4" })]).ok).toBe(false);
  });

  it("refuses an external id that is missing or unreasonably long", () => {
    expect(parseSamples([sample({ externalId: "" })]).ok).toBe(false);
    expect(parseSamples([sample({ externalId: "x".repeat(129) })]).ok).toBe(false);
  });

  it("tells too many apart from malformed, because the caller can act on it", () => {
    const many = Array.from({ length: MAX_IMPORT_SAMPLES + 1 }, (_, index) => sample({ externalId: `id-${index}` }));
    expect(parseSamples(many)).toEqual({ ok: false, error: "tooMany" });
  });

  /* An iPhone Shortcut cannot format a date in UTC - it writes the phone's own
     offset - so refusing an offset would mean asking that client to lie. */
  it("accepts an instant written with an offset, and stores it as UTC", () => {
    const parsed = parseSamples([sample({ recordedAt: "2026-09-05T09:14:00+02:00" })]);
    expect(parsed.ok && parsed.samples[0].recordedAt).toBe("2026-09-05T07:14:00.000Z");
  });

  it("still refuses an instant with no zone at all, which could mean anything", () => {
    expect(parseSamples([sample({ recordedAt: "2026-09-05T07:14:00" })]).ok).toBe(false);
  });

  /* `lastPerDay` compares these as strings, so two spellings of the same day
     have to come out of validation comparable. */
  it("normalises so that two spellings of one instant sort against each other", () => {
    const parsed = parseSamples([
      sample({ recordedAt: "2026-09-05T07:14:00Z", externalId: "utc" }),
      sample({ recordedAt: "2026-09-05T09:15:00+02:00", externalId: "offset" }),
    ]);
    expect(parsed.ok && parsed.samples.map((entry) => entry.recordedAt)).toEqual([
      "2026-09-05T07:14:00.000Z",
      "2026-09-05T07:15:00.000Z",
    ]);
  });
});
