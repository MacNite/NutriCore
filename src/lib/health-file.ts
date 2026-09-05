/**
 * Works out what a picked file is and reads it, in the browser.
 *
 * Four things arrive at this door: Apple's `export.zip`, the `export.xml`
 * inside it, Health Connect's `Health Connect.zip`, and the SQLite database
 * inside that. The format is decided by looking at the file rather than by
 * asking the user to declare it, because a person who has just exported their
 * health data knows where they saved it and not much else about it.
 */

import { readAppleHealthExport, type ReadProgress } from "./apple-health-export";
import { readHealthConnectDatabase } from "./health-connect-export";
import { type HealthPlatform, type HealthSample, lastPerDay } from "./health-import";
import { openZipEntry, readZipEntries, readZipEntryBytes, ZipUnsupportedError, type ZipEntry } from "./zip-read";

export type HealthFileErrorKind =
  | "unrecognised"
  | "zip64"
  | "compression"
  | "corrupt"
  | "databaseTooLarge"
  | "nothingFound";

export class HealthFileError extends Error {
  readonly kind: HealthFileErrorKind;
  constructor(kind: HealthFileErrorKind) {
    super(kind);
    this.name = "HealthFileError";
    this.kind = kind;
  }
}

/**
 * Turn a zip failure into something the UI has words for.
 *
 * Explicit rather than a cast of the thrown message: every kind here has a
 * translation behind it, and a cast would let a new one reach the screen as a
 * missing key. "Not a zip at all" is not a zip problem from the reader's point
 * of view - the user picked the wrong file - so it is reported as such.
 */
function asFileError(error: unknown): never {
  if (!(error instanceof ZipUnsupportedError)) throw error;
  switch (error.message) {
    case "zip64":
      throw new HealthFileError("zip64");
    case "compression":
      throw new HealthFileError("compression");
    case "corrupt":
      throw new HealthFileError("corrupt");
    default:
      throw new HealthFileError("unrecognised");
  }
}

/**
 * A Health Connect database is read whole, so it needs a ceiling. Real exports
 * are single-digit to low-double-digit megabytes; this is far above that and
 * far below what would take the tab down.
 */
const MAX_DATABASE_BYTES = 512 * 1024 * 1024;

export interface HealthFileResult {
  platform: HealthPlatform;
  /** Already collapsed to one sample per metric per day. */
  samples: HealthSample[];
  /** How many samples the file held before collapsing, for an honest count. */
  readCount: number;
  /** Tables that looked relevant but could not be read. Health Connect only. */
  skippedTables: string[];
}

/** `ReadableStream` is not async-iterable everywhere yet; this is the portable form. */
async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  /* The standard streams declare they accept `BufferSource`, which a stream of
     `Uint8Array` satisfies at runtime but not under `strict` - the DOM types
     make the buffer parameter invariant. Widening here is the whole of it. */
  const reader = (stream as ReadableStream<BufferSource>).pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

const isAppleXml = (name: string) => name.toLowerCase().endsWith("export.xml");
const isDatabase = (name: string) => /\.(db|sqlite|sqlite3)$/i.test(name);
/** macOS resource forks travel inside these zips and are never the payload. */
const isJunk = (name: string) => name.startsWith("__MACOSX/") || name.split("/").pop()?.startsWith("._") === true;

export async function readHealthFile(file: File, onProgress?: (progress: ReadProgress) => void): Promise<HealthFileResult> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xml")) return fromAppleStream(file.stream(), onProgress);
  if (isDatabase(name)) return fromDatabase(new Uint8Array(await file.arrayBuffer()));

  let entries: ZipEntry[];
  try {
    entries = await readZipEntries(file);
  } catch (error) {
    asFileError(error);
  }

  const usable = entries.filter((entry) => !isJunk(entry.name));

  const appleEntry = usable.find((entry) => isAppleXml(entry.name));
  if (appleEntry) {
    const stream = await open(file, appleEntry);
    return fromAppleStream(stream, onProgress);
  }

  // Health Connect names its database inconsistently across versions, so the
  // largest one in the archive is the one worth opening.
  const databases = usable.filter((entry) => isDatabase(entry.name)).sort((a, b) => b.uncompressedSize - a.uncompressedSize);
  if (databases.length > 0) {
    if (databases[0].uncompressedSize > MAX_DATABASE_BYTES) throw new HealthFileError("databaseTooLarge");
    return fromDatabase(await readBytes(file, databases[0]));
  }

  throw new HealthFileError("unrecognised");
}

async function open(file: File, entry: ZipEntry) {
  try {
    return await openZipEntry(file, entry);
  } catch (error) {
    asFileError(error);
  }
}

async function readBytes(file: File, entry: ZipEntry) {
  try {
    return await readZipEntryBytes(file, entry);
  } catch (error) {
    asFileError(error);
  }
}

async function fromAppleStream(stream: ReadableStream<Uint8Array>, onProgress?: (progress: ReadProgress) => void): Promise<HealthFileResult> {
  const samples = await readAppleHealthExport(streamChunks(stream), onProgress);
  if (samples.length === 0) throw new HealthFileError("nothingFound");
  return { platform: "APPLE_HEALTH", samples: lastPerDay(samples), readCount: samples.length, skippedTables: [] };
}

function fromDatabase(bytes: Uint8Array): HealthFileResult {
  const { samples, skipped } = readHealthConnectDatabase(bytes);
  if (samples.length === 0) throw new HealthFileError("nothingFound");
  return { platform: "HEALTH_CONNECT", samples: lastPerDay(samples), readCount: samples.length, skippedTables: skipped };
}
