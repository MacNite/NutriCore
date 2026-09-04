/**
 * The smallest xlsx reader that can read the Bundeslebensmittelschlüssel.
 *
 * BLS 4.0 ships as two .xlsx workbooks and nothing else, so converting them is
 * a build step NutriCore has to be able to run. A spreadsheet library would be
 * a heavyweight dependency used by one script that runs once per dataset
 * release, so the format is read directly instead: an xlsx file is a ZIP of
 * XML parts, and only three of them matter here.
 *
 * Deliberate limits, all satisfied by the BLS workbooks: no ZIP64 (the largest
 * part is 99 MB, well under 4 GB), no encryption, and dates are irrelevant
 * because every BLS cell is a number or a string.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** Reads the ZIP central directory: entry name -> {offset, method, sizes}. */
function readDirectory(buffer) {
  // The end-of-central-directory record sits in the last 64 KiB, after a
  // comment of unknown length, so it is found by scanning backwards.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 65_557; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file: no end-of-central-directory record");

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`Corrupt ZIP central directory at ${offset}`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inflates one entry. The local header repeats the name/extra lengths. */
function readEntry(buffer, entry) {
  const { localOffset, method, compressedSize } = entry;
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + compressedSize);
  if (method === 0) return raw;
  if (method === 8) return inflateRawSync(raw);
  throw new Error(`Unsupported ZIP compression method ${method}`);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text to plain text. BLS names carry &amp; and non-breaking hyphens. */
export function decodeXmlText(value) {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? match;
  });
}

/** Concatenated `<t>` runs of every `<si>`, indexed as the cells reference them. */
function readSharedStrings(xml) {
  const strings = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  for (const item of xml.matchAll(itemPattern)) {
    const body = item[1] ?? "";
    let text = "";
    for (const run of body.matchAll(textPattern)) text += decodeXmlText(run[1] ?? "");
    strings.push(text);
  }
  return strings;
}

/** "PB7141" -> 417. Column letters are base-26 with no zero digit. */
export function columnIndex(reference) {
  let index = 0;
  for (let i = 0; i < reference.length; i += 1) {
    const code = reference.charCodeAt(i);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/**
 * Yields one array per sheet row, indexed by column, with `undefined` for the
 * cells the file omits - an xlsx stores no empty cells, and BLS relies on that
 * for the handful of genuinely absent values.
 *
 * Values come back as numbers or strings exactly as stored: a BLS nutrient
 * column mixes both (`1443` beside `"-"`, `"TR"` or `"<LOD"`), and collapsing
 * that distinction here would destroy the difference between a measured zero
 * and an unknown value.
 */
export function* readSheetRows(path, { sheet = 1 } = {}) {
  const buffer = readFileSync(path);
  const directory = readDirectory(buffer);

  const sharedEntry = directory.get("xl/sharedStrings.xml");
  const shared = sharedEntry ? readSharedStrings(readEntry(buffer, sharedEntry).toString("utf8")) : [];

  const sheetName = `xl/worksheets/sheet${sheet}.xml`;
  const sheetEntry = directory.get(sheetName);
  if (!sheetEntry) throw new Error(`${path} has no ${sheetName}`);
  const xml = readEntry(buffer, sheetEntry).toString("utf8");

  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  const cellPattern = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;

  for (const rowMatch of xml.matchAll(rowPattern)) {
    const body = rowMatch[1];
    const row = [];
    if (!body) {
      yield row;
      continue;
    }
    for (const cellMatch of body.matchAll(cellPattern)) {
      const attributes = cellMatch[1] ?? "";
      const content = cellMatch[2] ?? "";
      const reference = /\br="([A-Z]+)/.exec(attributes);
      if (!reference) continue;
      const index = columnIndex(reference[1]);
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1] ?? "n";

      if (type === "inlineStr") {
        const text = [...content.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlText(m[1])).join("");
        row[index] = text === "" ? undefined : text;
        continue;
      }
      const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(content)?.[1];
      if (value === undefined) continue;
      if (type === "s") {
        row[index] = shared[Number(value)];
      } else if (type === "str") {
        row[index] = decodeXmlText(value);
      } else if (type === "e") {
        // A spreadsheet error such as #N/A carries no value; treat it as absent.
        row[index] = undefined;
      } else {
        const numeric = Number(value);
        row[index] = Number.isFinite(numeric) ? numeric : decodeXmlText(value);
      }
    }
    yield row;
  }
}
