import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAppleDate, readAppleHealthExport, sampleFromRecordTag, scanRecordTags, tagAttributes } from "./apple-health-export";
import type { HealthSample } from "./health-import";

const XML = readFileSync(new URL("../server/__fixtures__/apple-health-export.xml", import.meta.url), "utf8");

/** Feed the reader in fixed-size pieces, as a stream would. */
async function* inChunks(text: string, size: number) {
  for (let index = 0; index < text.length; index += size) yield text.slice(index, index + size);
}

const byMetric = (samples: HealthSample[], metric: string) => samples.filter((sample) => sample.metric === metric);

describe("parseAppleDate", () => {
  it("reads the offset as part of the value", () => {
    expect(parseAppleDate("2024-02-29 08:30:00 +0100")).toEqual({
      instantMs: Date.UTC(2024, 1, 29, 7, 30),
      offsetMinutes: 60,
    });
  });

  it("handles a negative offset and a colon in it", () => {
    expect(parseAppleDate("2024-02-29 08:30:00 -0500")?.instantMs).toBe(Date.UTC(2024, 1, 29, 13, 30));
    expect(parseAppleDate("2024-02-29 08:30:00 +05:30")?.offsetMinutes).toBe(330);
  });

  it("returns null for anything else", () => {
    expect(parseAppleDate("")).toBeNull();
    expect(parseAppleDate("2024-02-29")).toBeNull();
    expect(parseAppleDate("not a date")).toBeNull();
  });
});

describe("tagAttributes", () => {
  it("unescapes XML entities", () => {
    const attributes = tagAttributes('<Record sourceName="Tape &amp; Co" value="1" note="&quot;x&quot;"/>');
    expect(attributes.sourceName).toBe("Tape & Co");
    expect(attributes.note).toBe('"x"');
  });
});

describe("scanRecordTags", () => {
  it("keeps a tag split across a chunk boundary for the next chunk", () => {
    const first = scanRecordTags('<Record type="A" value="1"/><Rec');
    expect(first.tags).toHaveLength(1);
    expect(first.rest).toBe("<Rec");

    const second = scanRecordTags(`${first.rest}ord type="B" value="2"/>`);
    expect(second.tags).toEqual(['<Record type="B" value="2"/>']);
  });

  it("is not fooled by a > inside an attribute value", () => {
    const { tags } = scanRecordTags('<Record sourceName="A > B" value="1"/>');
    expect(tags).toEqual(['<Record sourceName="A > B" value="1"/>']);
  });
});

describe("sampleFromRecordTag", () => {
  it("ignores a type NutriCore does not store", () => {
    expect(sampleFromRecordTag('<Record type="HKQuantityTypeIdentifierHeartRate" unit="count/min" startDate="2024-02-29 09:00:00 +0100" value="61"/>')).toBeNull();
  });

  it("prefers startDate over creationDate", () => {
    // A scale synced at midnight files a reading taken the previous evening.
    const sample = sampleFromRecordTag(
      '<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" creationDate="2024-03-01 00:10:00 +0100" startDate="2024-02-29 20:55:00 +0100" value="79.1"/>',
    );
    expect(sample?.date).toBe("2024-02-29");
  });
});

describe("reading a whole export", () => {
  it("keeps only the metrics it can store", async () => {
    const samples = await readAppleHealthExport(inChunks(XML, 4096));
    expect([...new Set(samples.map((sample) => sample.metric))].sort()).toEqual(["bodyFatPct", "heightCm", "waistCm", "weightKg"]);
  });

  it("does not read lean body mass as muscle mass", async () => {
    // Lean mass counts bone, organs and water; it is not what muscleKg means.
    const samples = await readAppleHealthExport(inChunks(XML, 4096));
    expect(samples.some((sample) => sample.value === 60.9)).toBe(false);
  });

  it("converts each unit the file uses", async () => {
    const samples = await readAppleHealthExport(inChunks(XML, 4096));

    // 172.5 lb, recorded on the 1st of March.
    expect(byMetric(samples, "weightKg").find((sample) => sample.date === "2024-03-01")?.value).toBeCloseTo(78.25, 1);
    // 33.5 in.
    expect(byMetric(samples, "waistCm")[0].value).toBeCloseTo(85.09, 1);
    // A fraction, not a percentage.
    expect(byMetric(samples, "bodyFatPct")[0].value).toBeCloseTo(22.3, 1);
    expect(byMetric(samples, "heightCm")[0].value).toBe(183);
  });

  it("drops a reading that is out of range or in an unknown unit", async () => {
    const samples = await readAppleHealthExport(inChunks(XML, 4096));
    const weights = byMetric(samples, "weightKg");
    // The fixture holds a 0 kg reading and one measured in furlongs.
    expect(weights.some((sample) => sample.date === "2024-03-02")).toBe(false);
    expect(weights.some((sample) => sample.date === "2024-03-03")).toBe(false);
  });

  it("reads a record whose attributes straddle any chunk boundary", async () => {
    const whole = await readAppleHealthExport(inChunks(XML, XML.length));
    for (const size of [7, 13, 64, 512]) {
      expect(await readAppleHealthExport(inChunks(XML, size))).toEqual(whole);
    }
  });

  it("reports progress as it goes", async () => {
    const seen: number[] = [];
    await readAppleHealthExport(inChunks(XML, 256), (progress) => seen.push(progress.bytesRead));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(XML.length);
  });
});
