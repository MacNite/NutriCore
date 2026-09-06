/**
 * A read-only reader for the SQLite file format.
 *
 * Health Connect exports its data as an unencrypted SQLite database inside a
 * zip, so opening one means reading that format. The obvious route is sql.js,
 * and it was rejected: it is a 1.5 MB WebAssembly build of the whole engine,
 * and running it needs `'wasm-unsafe-eval'` added to `script-src` - for every
 * page in the application, permanently, so that one settings screen can read a
 * file. `src/lib/security-headers.ts` documents a reason for each exception it
 * already makes; "so we could avoid writing a b-tree walk" would not have been
 * a good addition to that list.
 *
 * What is implemented is the part needed to scan tables: the database header,
 * table b-trees, the record format, and overflow pages. Indices are ignored -
 * every read here is a full scan of a table small enough to walk - and nothing
 * writes. The on-disk format is documented and explicitly stable across
 * versions, which is what makes this worth doing by hand; the *schema* Health
 * Connect puts inside it is neither, which is why `health-connect-export.ts`
 * discovers its tables instead of naming them.
 *
 * Format reference: https://www.sqlite.org/fileformat.html
 */

const MAGIC = "SQLite format 3\0";

const PAGE_INTERIOR_TABLE = 0x05;
const PAGE_LEAF_TABLE = 0x0d;

export class SqliteFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqliteFormatError";
  }
}

export type SqlValue = number | string | Uint8Array | null;

export interface SqliteTable {
  name: string;
  rootPage: number;
  /** Column names in declaration order, read back out of the CREATE statement. */
  columns: string[];
}

/** A big-endian SQLite varint: up to nine bytes, seven bits each but the last. */
export function readVarint(bytes: Uint8Array, offset: number): { value: number; length: number } {
  let result = 0n;
  for (let i = 0; i < 8; i += 1) {
    const byte = bytes[offset + i];
    if (byte === undefined) throw new SqliteFormatError("truncated varint");
    if (i === 7) {
      result = (result << 8n) | BigInt(byte);
      return { value: Number(BigInt.asIntN(64, result)), length: 9 };
    }
    result = (result << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: Number(result), length: i + 1 };
  }
  throw new SqliteFormatError("malformed varint");
}

export class SqliteDatabase {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  readonly pageSize: number;
  /** Page size less the reserved tail some databases keep; all payload maths uses this. */
  readonly usableSize: number;

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength < 100) throw new SqliteFormatError("too short");
    const header = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
    if (header !== MAGIC) throw new SqliteFormatError("not a database");

    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const declared = this.view.getUint16(16, false);
    // 1 is how the format spells 65536, which does not fit the two bytes.
    this.pageSize = declared === 1 ? 65536 : declared;
    if (this.pageSize < 512 || (this.pageSize & (this.pageSize - 1)) !== 0) throw new SqliteFormatError("bad page size");
    this.usableSize = this.pageSize - this.bytes[20];
  }

  /** Page numbers are 1-based; page 1 carries the 100-byte file header. */
  private page(number: number): Uint8Array {
    const start = (number - 1) * this.pageSize;
    if (start < 0 || start + this.pageSize > this.bytes.byteLength) throw new SqliteFormatError(`page ${number} out of range`);
    return this.bytes.subarray(start, start + this.pageSize);
  }

  /**
   * Every row of one table, as raw column values.
   *
   * Depth-first through the b-tree, which returns rows in rowid order. Visited
   * pages are tracked because a corrupt file can otherwise point a page at its
   * own ancestor and spin here for ever.
   */
  *rows(rootPage: number): Generator<SqlValue[]> {
    const seen = new Set<number>();
    yield* this.walk(rootPage, seen);
  }

  private *walk(pageNumber: number, seen: Set<number>): Generator<SqlValue[]> {
    if (seen.has(pageNumber)) throw new SqliteFormatError("page cycle");
    seen.add(pageNumber);

    const page = this.page(pageNumber);
    // Only page 1 is offset, by the file header that shares it.
    const base = pageNumber === 1 ? 100 : 0;
    const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
    const type = page[base];
    const cellCount = view.getUint16(base + 3, false);

    if (type === PAGE_LEAF_TABLE) {
      const pointers = base + 8;
      for (let i = 0; i < cellCount; i += 1) {
        const cellOffset = view.getUint16(pointers + i * 2, false);
        yield this.readLeafCell(page, cellOffset);
      }
      return;
    }

    if (type === PAGE_INTERIOR_TABLE) {
      const pointers = base + 12;
      for (let i = 0; i < cellCount; i += 1) {
        const cellOffset = view.getUint16(pointers + i * 2, false);
        yield* this.walk(view.getUint32(cellOffset, false), seen);
      }
      // The right-most subtree hangs off the header rather than the cell array.
      yield* this.walk(view.getUint32(base + 8, false), seen);
      return;
    }

    throw new SqliteFormatError(`unexpected page type ${type}`);
  }

  private readLeafCell(page: Uint8Array, cellOffset: number): SqlValue[] {
    const size = readVarint(page, cellOffset);
    const rowid = readVarint(page, cellOffset + size.length);
    const payloadStart = cellOffset + size.length + rowid.length;
    return decodeRecord(this.payload(page, payloadStart, size.value), rowid.value);
  }

  /**
   * A cell's payload, following overflow pages when it did not fit.
   *
   * The spill threshold is the format's own arithmetic; getting it wrong reads
   * four bytes of page pointer as though they were column data, which is the
   * kind of bug that produces plausible nonsense rather than an error.
   */
  private payload(page: Uint8Array, start: number, total: number): Uint8Array {
    const maxLocal = this.usableSize - 35;
    if (total <= maxLocal) return page.subarray(start, start + total);

    const minLocal = Math.floor(((this.usableSize - 12) * 32) / 255) - 23;
    const k = minLocal + ((total - minLocal) % (this.usableSize - 4));
    const localSize = k <= maxLocal ? k : minLocal;

    const out = new Uint8Array(total);
    out.set(page.subarray(start, start + localSize), 0);

    const pageView = new DataView(page.buffer, page.byteOffset, page.byteLength);
    let next = pageView.getUint32(start + localSize, false);
    let written = localSize;
    const visited = new Set<number>();

    while (next !== 0 && written < total) {
      if (visited.has(next)) throw new SqliteFormatError("overflow cycle");
      visited.add(next);

      const overflow = this.page(next);
      const chunk = Math.min(this.usableSize - 4, total - written);
      out.set(overflow.subarray(4, 4 + chunk), written);
      written += chunk;
      next = new DataView(overflow.buffer, overflow.byteOffset, overflow.byteLength).getUint32(0, false);
    }

    return out;
  }

  /**
   * The tables this database declares, from `sqlite_master` on page 1.
   *
   * Its own layout is fixed by the format: type, name, tbl_name, rootpage, sql.
   */
  tables(): SqliteTable[] {
    const tables: SqliteTable[] = [];
    for (const row of this.rows(1)) {
      const [kind, name, , rootPage, sql] = row;
      if (kind !== "table" || typeof name !== "string" || typeof rootPage !== "number" || rootPage <= 0) continue;
      tables.push({ name, rootPage, columns: typeof sql === "string" ? columnNames(sql) : [] });
    }
    return tables;
  }
}

/** One record's column values, with the rowid substituted where the format omits it. */
export function decodeRecord(payload: Uint8Array, rowid: number): SqlValue[] {
  const headerSize = readVarint(payload, 0);
  const serialTypes: number[] = [];

  let cursor = headerSize.length;
  while (cursor < headerSize.value) {
    const serial = readVarint(payload, cursor);
    serialTypes.push(serial.value);
    cursor += serial.length;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const values: SqlValue[] = [];
  let offset = headerSize.value;

  for (const serial of serialTypes) {
    switch (serial) {
      case 0:
        // A NULL here is how an INTEGER PRIMARY KEY column stores the rowid.
        values.push(rowid);
        break;
      case 1:
        values.push(view.getInt8(offset));
        offset += 1;
        break;
      case 2:
        values.push(view.getInt16(offset, false));
        offset += 2;
        break;
      case 3:
        values.push((view.getInt16(offset, false) << 8) | view.getUint8(offset + 2));
        offset += 3;
        break;
      case 4:
        values.push(view.getInt32(offset, false));
        offset += 4;
        break;
      case 5:
        values.push(Number((BigInt(view.getInt16(offset, false)) << 32n) | BigInt(view.getUint32(offset + 2, false))));
        offset += 6;
        break;
      case 6:
        values.push(Number(view.getBigInt64(offset, false)));
        offset += 8;
        break;
      case 7:
        values.push(view.getFloat64(offset, false));
        offset += 8;
        break;
      case 8:
        values.push(0);
        break;
      case 9:
        values.push(1);
        break;
      default: {
        if (serial < 12) throw new SqliteFormatError(`reserved serial type ${serial}`);
        const length = (serial - (serial % 2 === 0 ? 12 : 13)) / 2;
        const slice = payload.subarray(offset, offset + length);
        values.push(serial % 2 === 0 ? new Uint8Array(slice) : new TextDecoder().decode(slice));
        offset += length;
      }
    }
  }

  return values;
}

/**
 * Column names out of a CREATE TABLE statement.
 *
 * Splitting on top-level commas and taking the first identifier of each part is
 * enough for a schema that was written by SQLite itself: table-level constraints
 * are recognised by their leading keyword and skipped.
 */
export function columnNames(sql: string): string[] {
  const open = sql.indexOf("(");
  if (open === -1) return [];

  let depth = 0;
  let end = -1;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];

  const parts: string[] = [];
  let current = "";
  depth = 0;
  let quote = "";

  for (let i = open + 1; i < end; i += 1) {
    const char = sql[i];
    if (quote) {
      if (char === quote) quote = "";
      current += char;
      continue;
    }
    if (char === '"' || char === "'" || char === "`" || char === "[") {
      quote = char === "[" ? "]" : char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  const CONSTRAINTS = new Set(["constraint", "primary", "unique", "check", "foreign"]);
  const names: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const first = /^(?:"([^"]*)"|`([^`]*)`|\[([^\]]*)\]|([A-Za-z_][\w$]*))/.exec(trimmed);
    if (!first) continue;
    const name = first[1] ?? first[2] ?? first[3] ?? first[4];
    // An unquoted leading keyword is a table constraint, not a column.
    if (first[4] !== undefined && CONSTRAINTS.has(name.toLowerCase())) continue;
    names.push(name);
  }

  return names;
}
