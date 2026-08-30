import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./export";

describe("CSV escaping", () => {
  it("quotes fields containing a delimiter, quote or newline", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("Müsli, Schoko")).toBe('"Müsli, Schoko"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("writes an unknown value as an empty cell, not a zero", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
  });

  it("joins rows with CRLF", () => {
    expect(toCsv([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2");
  });

  it("cannot break out of a cell with an injected delimiter", () => {
    const row = toCsv([[`a,b`, "c"]]);
    expect(row.split(",")).toHaveLength(3);
    expect(row).toBe('"a,b",c');
  });
});
