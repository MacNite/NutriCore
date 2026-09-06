/**
 * Reader for a Health Connect export.
 *
 * The archive holds an unencrypted SQLite database, and that is the whole of
 * the contract: Google documents neither the schema inside it nor any promise
 * to keep it. The tables below were read off real exports, but a platform
 * update may rename a column tomorrow and nothing would announce it.
 *
 * So nothing here is hard-coded against a schema version. Tables are found by
 * what they look like - a name mentioning the metric, a time column, a numeric
 * value column - and every value is checked against the range a human body
 * occupies before it is believed. Units are inferred the same way, because the
 * database states none: a weight column holding 70000 is grams and one holding
 * 70 is kilograms, and no realistic body mass is ambiguous between them.
 *
 * The failure mode this buys is the right one. A schema we no longer recognise
 * produces "nothing recognisable in this file", which a user can act on, rather
 * than a column read at the wrong scale and charted as though it were a
 * measurement.
 */

import {
  type HealthMetric,
  type HealthSample,
  inRange,
  localDateKey,
  percentToPct,
  stableId,
} from "./health-import";
import { SqliteDatabase, type SqlValue, type SqliteTable } from "./sqlite-read";

interface MetricShape {
  metric: HealthMetric;
  /** Every fragment must appear in the table name, which is how `weight` avoids `lean_body_mass`. */
  nameIncludes: string[];
  nameExcludes: string[];
  /** Column names worth trying for the reading itself, best first. */
  valueColumns: string[];
  /** Multipliers to try against the stored number, best first. */
  scales: number[];
}

/**
 * Lean body mass is deliberately not listed: it is not muscle mass, and
 * `health-import.ts` explains why nothing maps onto `muscleKg`.
 */
const SHAPES: MetricShape[] = [
  {
    metric: "weightKg",
    nameIncludes: ["weight"],
    nameExcludes: ["lean", "goal", "target"],
    valueColumns: ["weight", "weight_kg", "mass", "value"],
    // kilograms as stored, then grams.
    scales: [1, 0.001],
  },
  {
    metric: "bodyFatPct",
    nameIncludes: ["body_fat"],
    nameExcludes: [],
    valueColumns: ["percentage", "body_fat_percentage", "value"],
    // Handled by percentToPct, which copes with both a fraction and a percentage.
    scales: [1],
  },
  {
    metric: "heightCm",
    nameIncludes: ["height"],
    nameExcludes: [],
    valueColumns: ["height", "height_cm", "value"],
    // metres as stored, then centimetres, then millimetres.
    scales: [100, 1, 0.1],
  },
  {
    metric: "waistCm",
    nameIncludes: ["waist"],
    nameExcludes: [],
    valueColumns: ["circumference", "waist_circumference", "value"],
    scales: [100, 1, 0.1],
  },
];

const TIME_COLUMNS = ["time", "epoch_millis", "start_time", "time_millis", "instant"];
const OFFSET_COLUMNS = ["zone_offset", "zone_offset_seconds", "start_zone_offset", "offset"];
const UUID_COLUMNS = ["uuid", "client_record_id", "row_id", "id"];

/** Instants outside this span are a column that is not a timestamp. */
const MIN_INSTANT = Date.UTC(1990, 0, 1);
const MAX_INSTANT = Date.UTC(2100, 0, 1);

/**
 * A stored timestamp as epoch milliseconds.
 *
 * Health Connect writes milliseconds, but a column holding seconds reads as
 * 1970 rather than failing, so the scale is checked rather than assumed.
 */
export function toInstantMs(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  for (const scale of [1, 1000]) {
    const value = raw * scale;
    if (value >= MIN_INSTANT && value <= MAX_INSTANT) return value;
  }
  return null;
}

/**
 * A stored zone offset in minutes.
 *
 * Seconds is what Health Connect records, but the same ambiguity applies and
 * the answer is bounded: no real zone is more than 18 hours from UTC.
 */
export function toOffsetMinutes(raw: SqlValue): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  for (const divisor of [60, 1, 60_000]) {
    const minutes = raw / divisor;
    if (Number.isInteger(minutes) && Math.abs(minutes) <= 18 * 60) return minutes;
  }
  return 0;
}

const columnIndex = (table: SqliteTable, candidates: string[]): number => {
  const lower = table.columns.map((name) => name.toLowerCase());
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate);
    if (index !== -1) return index;
  }
  return -1;
};

/** Tables whose name matches a metric's shape. */
export function matchTables(tables: SqliteTable[], shape: MetricShape): SqliteTable[] {
  return tables.filter((table) => {
    const name = table.name.toLowerCase();
    return shape.nameIncludes.every((part) => name.includes(part)) && !shape.nameExcludes.some((part) => name.includes(part));
  });
}

/**
 * The scale that puts most readings inside a plausible range.
 *
 * Tried in the declared order and the first that explains at least four fifths
 * of the rows wins, so a handful of junk readings cannot drag the whole column
 * to the wrong unit. A column no scale explains yields null and is skipped
 * rather than guessed at.
 */
export function inferScale(values: number[], metric: HealthMetric, scales: number[]): number | null {
  if (values.length === 0) return null;

  for (const scale of scales) {
    let plausible = 0;
    for (const value of values) {
      const scaled = metric === "bodyFatPct" ? percentToPct(value * scale) : value * scale;
      if (scaled !== null && inRange(metric, scaled)) plausible += 1;
    }
    if (plausible / values.length >= 0.8) return scale;
  }

  return null;
}

export interface HealthConnectReadResult {
  samples: HealthSample[];
  /** Tables that looked right but could not be read, for an honest message. */
  skipped: string[];
}

/** Every sample a Health Connect database yields, with what could not be read. */
export function readHealthConnectDatabase(bytes: Uint8Array): HealthConnectReadResult {
  const db = new SqliteDatabase(bytes);
  const tables = db.tables();
  const samples: HealthSample[] = [];
  const skipped: string[] = [];

  for (const shape of SHAPES) {
    for (const table of matchTables(tables, shape)) {
      const valueAt = columnIndex(table, shape.valueColumns);
      const timeAt = columnIndex(table, TIME_COLUMNS);
      if (valueAt === -1 || timeAt === -1) {
        skipped.push(table.name);
        continue;
      }

      const offsetAt = columnIndex(table, OFFSET_COLUMNS);
      const uuidAt = columnIndex(table, UUID_COLUMNS);

      const rows = [...db.rows(table.rootPage)];
      const numbers = rows.map((row) => row[valueAt]).filter((value): value is number => typeof value === "number");
      const scale = inferScale(numbers, shape.metric, shape.scales);
      if (scale === null) {
        skipped.push(table.name);
        continue;
      }

      for (const row of rows) {
        const raw = row[valueAt];
        const rawTime = row[timeAt];
        if (typeof raw !== "number" || typeof rawTime !== "number") continue;

        const instantMs = toInstantMs(rawTime);
        if (instantMs === null) continue;

        const scaled = shape.metric === "bodyFatPct" ? percentToPct(raw * scale) : raw * scale;
        if (scaled === null || !inRange(shape.metric, scaled)) continue;

        const offsetMinutes = offsetAt === -1 ? 0 : toOffsetMinutes(row[offsetAt]);
        const identity = uuidAt === -1 ? null : row[uuidAt];

        samples.push({
          metric: shape.metric,
          date: localDateKey(instantMs, offsetMinutes),
          recordedAt: new Date(instantMs).toISOString(),
          value: Math.round(scaled * 100) / 100,
          externalId: stableId([
            shape.metric,
            typeof identity === "string" || typeof identity === "number" ? String(identity) : `${table.name}:${instantMs}:${raw}`,
          ]),
          source: null,
        });
      }
    }
  }

  return { samples, skipped };
}
