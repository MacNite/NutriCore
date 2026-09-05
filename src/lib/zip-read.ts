/**
 * Just enough ZIP to open a health export in the browser.
 *
 * Both exports arrive zipped, and neither needs a library to open: the browser
 * has had `DecompressionStream("deflate-raw")` for years, and the container
 * around it is a few fixed-width headers. Reading the central directory by
 * ranged `Blob.slice` rather than loading the archive means an 800 MB Apple
 * export costs a couple of kilobytes to inspect, and each entry is streamed
 * rather than buffered.
 *
 * Deliberately partial: no encryption, no ZIP64, no multi-disk. A file needing
 * any of those is refused by name instead of being read wrongly - see
 * `ZipUnsupportedError`.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
/** ZIP64 writes this in a 32-bit field to say "the real value is in the extra block". */
const ZIP64_SENTINEL = 0xffffffff;

export class ZipUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipUnsupportedError";
  }
}

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. Anything else is refused. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Offset of the end-of-central-directory record within `tail`, or -1.
 *
 * Scanned backwards because the signature may also occur inside file data, and
 * the last match is the real one.
 */
export function findEndOfCentralDirectory(tail: Uint8Array): number {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let offset = tail.byteLength - EOCD_MIN_SIZE; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** Parse the fixed part of the central directory, given its bytes. */
export function parseCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 46 <= bytes.byteLength && view.getUint32(offset, true) === CENTRAL_SIGNATURE) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL || localHeaderOffset === ZIP64_SENTINEL) {
      throw new ZipUnsupportedError("zip64");
    }

    entries.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** List what an archive holds, reading only its directory. */
export async function readZipEntries(blob: Blob): Promise<ZipEntry[]> {
  const tailLength = Math.min(blob.size, EOCD_MIN_SIZE + MAX_COMMENT);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLength).arrayBuffer());

  const eocd = findEndOfCentralDirectory(tail);
  if (eocd === -1) throw new ZipUnsupportedError("notAZip");

  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (directoryOffset === ZIP64_SENTINEL || directorySize === ZIP64_SENTINEL) throw new ZipUnsupportedError("zip64");

  const directory = new Uint8Array(await blob.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer());
  return parseCentralDirectory(directory);
}

/**
 * Where an entry's compressed bytes actually start.
 *
 * The central directory points at the local header, whose name and extra fields
 * may differ in length from the ones in the directory - so the local header has
 * to be read to find the data behind it.
 */
async function entryDataOffset(blob: Blob, entry: ZipEntry): Promise<number> {
  const header = new Uint8Array(await blob.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer());
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipUnsupportedError("corrupt");
  return entry.localHeaderOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
}

/** One entry as a byte stream, inflated if it needs to be. */
export async function openZipEntry(blob: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  if (entry.method !== 0 && entry.method !== 8) throw new ZipUnsupportedError("compression");

  const start = await entryDataOffset(blob, entry);
  /* Typed as BufferSource rather than Uint8Array because that is what the
     standard streams declare they accept, and it is what lets `pipeThrough`
     line up with `DecompressionStream` without a cast. */
  const raw: ReadableStream<BufferSource> = blob.slice(start, start + entry.compressedSize).stream();
  return entry.method === 0 ? (raw as ReadableStream<Uint8Array>) : raw.pipeThrough(new DecompressionStream("deflate-raw"));
}

/** One entry, fully in memory. Only for entries known to be small. */
export async function readZipEntryBytes(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  const stream = await openZipEntry(blob, entry);
  const parts: Uint8Array[] = [];
  let total = 0;

  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
