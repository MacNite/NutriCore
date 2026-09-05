import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findEndOfCentralDirectory, parseCentralDirectory, readZipEntries, readZipEntryBytes, ZipUnsupportedError } from "./zip-read";

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`../server/__fixtures__/${name}`, import.meta.url)));

/** `Blob` and `DecompressionStream` are both present in Node 22, as in a browser. */
const asBlob = (name: string) => new Blob([bytes(name) as unknown as BlobPart]);

describe("findEndOfCentralDirectory", () => {
  it("returns -1 when the signature is absent", () => {
    expect(findEndOfCentralDirectory(new Uint8Array(64))).toBe(-1);
  });

  it("takes the last signature, not the first", () => {
    // A signature occurring inside file data must not win over the real record.
    const buffer = new Uint8Array(64);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint32(40, 0x06054b50, true);
    expect(findEndOfCentralDirectory(buffer)).toBe(40);
  });
});

describe("parseCentralDirectory", () => {
  it("stops cleanly at bytes that are not a directory record", () => {
    expect(parseCentralDirectory(new Uint8Array(46))).toEqual([]);
  });
});

describe("reading an archive", () => {
  it("lists what an Apple export holds", async () => {
    const entries = await readZipEntries(asBlob("apple-health-export.zip"));
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "apple_health_export/export.xml",
      "apple_health_export/export_cda.xml",
    ]);
  });

  it("inflates a deflated entry back to its original bytes", async () => {
    const blob = asBlob("apple-health-export.zip");
    const entries = await readZipEntries(blob);
    const entry = entries.find((candidate) => candidate.name.endsWith("export.xml"))!;

    const inflated = await readZipEntryBytes(blob, entry);
    expect(inflated.byteLength).toBe(entry.uncompressedSize);
    expect(new TextDecoder().decode(inflated)).toBe(readFileSync(new URL("../server/__fixtures__/apple-health-export.xml", import.meta.url), "utf8"));
  });

  it("reads a Health Connect archive, resource forks and all", async () => {
    const entries = await readZipEntries(asBlob("health-connect-export.zip"));
    expect(entries.map((entry) => entry.name)).toContain("health_connect_export.db");
    expect(entries.map((entry) => entry.name)).toContain("__MACOSX/._health_connect_export.db");
  });

  it("refuses something that is not an archive", async () => {
    await expect(readZipEntries(new Blob(["not a zip at all"]))).rejects.toThrow(ZipUnsupportedError);
  });
});
