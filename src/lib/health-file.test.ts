import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HealthFileError, readHealthFile } from "./health-file";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../server/__fixtures__/${name}`, import.meta.url)));

/** `File` exists in Node 22 and behaves as the browser's does for slicing and streaming. */
const asFile = (name: string, as = name) => new File([fixture(name) as unknown as BlobPart], as);

describe("recognising a file", () => {
  it("reads an Apple export.zip by finding the xml inside it", async () => {
    const result = await readHealthFile(asFile("apple-health-export.zip", "export.zip"));
    expect(result.platform).toBe("APPLE_HEALTH");
    expect(result.samples.length).toBeGreaterThan(0);
  });

  it("reads a bare export.xml", async () => {
    const result = await readHealthFile(asFile("apple-health-export.xml", "export.xml"));
    expect(result.platform).toBe("APPLE_HEALTH");
  });

  it("reads a Health Connect zip by finding the database inside it", async () => {
    const result = await readHealthFile(asFile("health-connect-export.zip", "Health Connect.zip"));
    expect(result.platform).toBe("HEALTH_CONNECT");
    expect(result.samples.length).toBeGreaterThan(0);
  });

  it("reads a bare database", async () => {
    const result = await readHealthFile(asFile("health-connect.db", "health_connect_export.db"));
    expect(result.platform).toBe("HEALTH_CONNECT");
  });

  it("gets the same readings from an archive as from the file inside it", async () => {
    const zipped = await readHealthFile(asFile("apple-health-export.zip", "export.zip"));
    const bare = await readHealthFile(asFile("apple-health-export.xml", "export.xml"));
    expect(zipped.samples).toEqual(bare.samples);
  });

  it("collapses to one reading per metric per day", async () => {
    const result = await readHealthFile(asFile("apple-health-export.xml", "export.xml"));
    const keys = result.samples.map((sample) => `${sample.metric} ${sample.date}`);
    expect(new Set(keys).size).toBe(keys.length);
    // The fixture holds two weights on the 29th, so more were read than kept.
    expect(result.readCount).toBeGreaterThan(result.samples.length);
  });

  it("says so when a file is not a health export", async () => {
    await expect(readHealthFile(new File(["hello"], "notes.zip"))).rejects.toMatchObject({ kind: "unrecognised" });
  });

  it("says so when an export holds nothing it can store", async () => {
    const empty = '<?xml version="1.0"?><HealthData><Record type="HKQuantityTypeIdentifierHeartRate" unit="count/min" startDate="2024-02-29 09:00:00 +0100" value="61"/></HealthData>';
    await expect(readHealthFile(new File([empty], "export.xml"))).rejects.toMatchObject({ kind: "nothingFound" });
  });

  it("reports failures as HealthFileError so the UI can name them", async () => {
    await expect(readHealthFile(new File(["hello"], "notes.zip"))).rejects.toBeInstanceOf(HealthFileError);
  });
});
