import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { columnNames, decodeRecord, readVarint, SqliteDatabase, SqliteFormatError } from "./sqlite-read";

const DB = new Uint8Array(readFileSync(new URL("../server/__fixtures__/health-connect.db", import.meta.url)));

describe("readVarint", () => {
  it("reads a single byte", () => {
    expect(readVarint(new Uint8Array([0x00]), 0)).toEqual({ value: 0, length: 1 });
    expect(readVarint(new Uint8Array([0x7f]), 0)).toEqual({ value: 127, length: 1 });
  });

  it("reads a continuation across bytes", () => {
    // 0x81 0x00 is 128: seven bits per byte, most significant first.
    expect(readVarint(new Uint8Array([0x81, 0x00]), 0)).toEqual({ value: 128, length: 2 });
    expect(readVarint(new Uint8Array([0x82, 0x2c]), 0)).toEqual({ value: 300, length: 2 });
  });

  it("refuses a varint that runs off the end", () => {
    expect(() => readVarint(new Uint8Array([0x81]), 0)).toThrow(SqliteFormatError);
  });
});

describe("columnNames", () => {
  it("reads columns in declaration order", () => {
    expect(columnNames("CREATE TABLE t (a INTEGER, b TEXT, c REAL)")).toEqual(["a", "b", "c"]);
  });

  it("skips table-level constraints", () => {
    expect(columnNames("CREATE TABLE t (a INTEGER, b TEXT, PRIMARY KEY(a), UNIQUE(b), FOREIGN KEY(a) REFERENCES u(id))")).toEqual(["a", "b"]);
  });

  it("keeps a quoted name and is not split by a comma inside one", () => {
    expect(columnNames('CREATE TABLE t ("a,b" INTEGER, `c d` TEXT, [e] REAL)')).toEqual(["a,b", "c d", "e"]);
  });

  it("is not confused by a type with its own parentheses", () => {
    expect(columnNames("CREATE TABLE t (a DECIMAL(8,2), b VARCHAR(20))")).toEqual(["a", "b"]);
  });

  it("does not mistake a column named like a keyword for a constraint", () => {
    expect(columnNames('CREATE TABLE t (a INTEGER, "unique" TEXT)')).toEqual(["a", "unique"]);
  });
});

describe("decodeRecord", () => {
  it("substitutes the rowid where the format stores NULL for it", () => {
    // Header of 2 bytes, one column of serial type 0 (NULL).
    expect(decodeRecord(new Uint8Array([0x02, 0x00]), 42)).toEqual([42]);
  });

  it("reads the constant serial types without consuming bytes", () => {
    expect(decodeRecord(new Uint8Array([0x03, 0x08, 0x09]), 1)).toEqual([0, 1]);
  });
});

describe("reading a database", () => {
  const db = new SqliteDatabase(DB);

  it("rejects something that is not one", () => {
    expect(() => new SqliteDatabase(new Uint8Array(200))).toThrow(SqliteFormatError);
    expect(() => new SqliteDatabase(new Uint8Array(4))).toThrow(SqliteFormatError);
  });

  it("lists the tables with their columns", () => {
    const names = db.tables().map((table) => table.name);
    expect(names).toContain("weight_record_table");
    expect(names).toContain("body_fat_record_table");

    const weight = db.tables().find((table) => table.name === "weight_record_table");
    expect(weight?.columns).toEqual(["row_id", "app_info_id", "uuid", "time", "zone_offset", "weight"]);
  });

  it("returns every row of a table", () => {
    const weight = db.tables().find((table) => table.name === "weight_record_table")!;
    const rows = [...db.rows(weight.rootPage)];
    // Ten daily readings plus two on the same day.
    expect(rows).toHaveLength(12);
    expect(rows[0][2]).toBe("w-0");
  });
});
