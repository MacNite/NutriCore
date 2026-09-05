/**
 * Reader for Apple Health's `export.xml`.
 *
 * The file is one flat `<HealthData>` element holding every `<Record>` the
 * phone has ever stored, and it is regularly hundreds of megabytes - too large
 * to hold as a string, let alone to build a DOM from. So this is a scanner
 * rather than a parser: it walks chunks of text, lifts the opening tag of each
 * `<Record>`, and keeps only the handful whose type is one of ours. Everything
 * between the tags - metadata entries, heart rate, sleep, clinical documents -
 * is passed over without being materialised.
 *
 * A record looks like this, and may be self-closing or wrap child elements:
 *
 *   <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Withings"
 *           unit="kg" creationDate="2024-03-15 07:32:11 +0100"
 *           startDate="2024-03-15 07:32:00 +0100"
 *           endDate="2024-03-15 07:32:00 +0100" value="78.4"/>
 */

import {
  type HealthMetric,
  type HealthSample,
  inRange,
  lengthToCm,
  localDateKey,
  massToKg,
  percentToPct,
  stableId,
} from "./health-import";

/** The HealthKit identifiers worth reading, and what each becomes. */
const TYPE_TO_METRIC: Record<string, HealthMetric> = {
  HKQuantityTypeIdentifierBodyMass: "weightKg",
  HKQuantityTypeIdentifierBodyFatPercentage: "bodyFatPct",
  HKQuantityTypeIdentifierHeight: "heightCm",
  HKQuantityTypeIdentifierWaistCircumference: "waistCm",
};

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

const unescapeXml = (value: string) =>
  value.replace(/&(?:amp|lt|gt|quot|apos|#\d+);/g, (entity) => {
    if (entity in XML_ENTITIES) return XML_ENTITIES[entity];
    const code = Number(entity.slice(2, -1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });

/** Attributes of one opening tag. Values are quoted, so a `>` inside one is safe. */
export function tagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_:][\w.:-]*)\s*=\s*"([^"]*)"/g;
  let match = pattern.exec(tag);
  while (match !== null) {
    attributes[match[1]] = unescapeXml(match[2]);
    match = pattern.exec(tag);
  }
  return attributes;
}

/**
 * Apple writes `2024-03-15 07:32:11 +0100`, which no `Date` constructor reads
 * the same way twice. The offset is part of the value and is what makes the
 * calendar day knowable without asking the user what timezone they are in.
 */
export function parseAppleDate(value: string): { instantMs: number; offsetMinutes: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*([+-])(\d{2}):?(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * (sign === "-" ? -1 : 1);
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (!Number.isFinite(utc)) return null;

  return { instantMs: utc - offset * 60_000, offsetMinutes: offset };
}

/** One `<Record>` opening tag to a sample, or null if it is not one of ours. */
export function sampleFromRecordTag(tag: string): HealthSample | null {
  const attributes = tagAttributes(tag);
  const metric = TYPE_TO_METRIC[attributes.type];
  if (!metric) return null;

  const raw = Number(attributes.value);
  if (!Number.isFinite(raw)) return null;

  // `startDate` is when the reading was taken; `creationDate` is when the phone
  // filed it, which for a scale synced hours later is a different day.
  const stamp = parseAppleDate(attributes.startDate ?? attributes.creationDate ?? "");
  if (!stamp) return null;

  const unit = attributes.unit ?? "";
  let value: number | null;
  switch (metric) {
    case "weightKg":
      value = massToKg(raw, unit);
      break;
    case "heightCm":
    case "waistCm":
      value = lengthToCm(raw, unit);
      break;
    case "bodyFatPct":
      value = percentToPct(raw);
      break;
  }
  if (value === null || !inRange(metric, value)) return null;

  const source = attributes.sourceName?.trim() || null;
  return {
    metric,
    date: localDateKey(stamp.instantMs, stamp.offsetMinutes),
    recordedAt: new Date(stamp.instantMs).toISOString(),
    value: Math.round(value * 100) / 100,
    externalId: stableId([attributes.type, attributes.startDate ?? "", attributes.value, source ?? ""]),
    source,
  };
}

/**
 * Pull complete `<Record` opening tags out of a chunk, returning the trailing
 * fragment that has not been closed yet so the caller can prepend it to the next
 * chunk. Quotes are tracked because an attribute value may legitimately hold a
 * `>` - a source named `A > B` is unusual but not invalid.
 */
export function scanRecordTags(text: string): { tags: string[]; rest: string } {
  const tags: string[] = [];
  let cursor = 0;

  for (;;) {
    const start = text.indexOf("<Record", cursor);
    if (start === -1) {
      // Keep back enough to catch a `<Record` split across the chunk boundary.
      const tail = Math.max(cursor, text.length - "<Record".length);
      return { tags, rest: text.slice(tail) };
    }

    let quoted = false;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"') quoted = !quoted;
      else if (char === ">" && !quoted) {
        end = i;
        break;
      }
    }
    if (end === -1) return { tags, rest: text.slice(start) };

    tags.push(text.slice(start, end + 1));
    cursor = end + 1;
  }
}

export interface ReadProgress {
  /** Bytes of the file consumed so far, for a progress bar. */
  bytesRead: number;
  /** Samples kept so far. */
  found: number;
}

/**
 * Stream an `export.xml` and return every sample it holds.
 *
 * `chunks` is normally `file.stream().pipeThrough(new TextDecoderStream())`.
 * The reader awaits between chunks, which is what keeps a gigabyte file from
 * freezing the page: the event loop gets a turn on every block.
 */
export async function readAppleHealthExport(
  chunks: AsyncIterable<string>,
  onProgress?: (progress: ReadProgress) => void,
): Promise<HealthSample[]> {
  const samples: HealthSample[] = [];
  let carry = "";
  let bytesRead = 0;

  for await (const chunk of chunks) {
    bytesRead += chunk.length;
    const { tags, rest } = scanRecordTags(carry + chunk);
    for (const tag of tags) {
      const sample = sampleFromRecordTag(tag);
      if (sample) samples.push(sample);
    }
    carry = rest;
    onProgress?.({ bytesRead, found: samples.length });
  }

  const { tags } = scanRecordTags(carry);
  for (const tag of tags) {
    const sample = sampleFromRecordTag(tag);
    if (sample) samples.push(sample);
  }

  return samples;
}
