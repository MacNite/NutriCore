import type { BodyMeasurement, BodyProfile } from "./body-metrics";

/**
 * PROTOTYPE DATA — invented, not anyone's real measurements.
 *
 * The body-progress preview evaluates layout and interaction before any
 * persistence exists, so it needs a plausible history rather than a database.
 * Delete this file together with the preview route.
 */

/** A fictional adult profile. RFM needs a sex and an age, so both are present. */
export const MOCK_PROFILE: BodyProfile = { heightCm: 182, sex: "male", ageYears: 34 };

interface Track {
  /** Value at the first entry, at the reference entry and at the last entry. */
  start: number;
  reference: number;
  current: number;
  /** Amplitude of the day-to-day noise between those anchors. */
  wobble: number;
}

const TRACKS = {
  weightKg: { start: 86.5, reference: 83.2, current: 78.4, wobble: 0.55 },
  neckCm: { start: 40.2, reference: 39.5, current: 38.8, wobble: 0.15 },
  chestCm: { start: 101.0, reference: 102.0, current: 103.2, wobble: 0.35 },
  waistCm: { start: 94.5, reference: 90.0, current: 84.2, wobble: 0.5 },
  hipCm: { start: 105.0, reference: 103.0, current: 100.9, wobble: 0.4 },
  upperArmCm: { start: 33.4, reference: 34.0, current: 34.8, wobble: 0.2 },
  thighCm: { start: 58.2, reference: 59.0, current: 60.0, wobble: 0.3 },
  calfCm: { start: 39.2, reference: 39.0, current: 38.8, wobble: 0.2 },
  bodyFatPct: { start: 22.4, reference: 20.6, current: 18.4, wobble: 0.35 },
  muscleKg: { start: 33.1, reference: 33.7, current: 34.8, wobble: 0.3 },
  bodyWaterPct: { start: 53.6, reference: 54.5, current: 55.1, wobble: 0.3 },
  boneKg: { start: 3.2, reference: 3.2, current: 3.2, wobble: 0 },
} satisfies Record<string, Track>;

const FIRST_DATE = "2026-02-10";
const REFERENCE_INDEX = 13;
const WEEKLY_ENTRIES = 29;
/** The final session slipped by a day, the way a real weekly routine does. */
const LAST_DATE = "2026-09-02";

function dateAt(index: number) {
  if (index >= WEEKLY_ENTRIES) return LAST_DATE;
  const start = Date.parse(`${FIRST_DATE}T00:00:00Z`);
  return new Date(start + index * 7 * 86_400_000).toISOString().slice(0, 10);
}

const LAST_INDEX = WEEKLY_ENTRIES;

/**
 * Deterministic so server and client render the same figures. The noise is
 * shaped by a sine that reaches zero at every anchor, which keeps the reference
 * and current entries exactly on their stated values.
 */
function valueAt(track: Track, index: number, phase: number): number {
  const beforeReference = index <= REFERENCE_INDEX;
  const from = beforeReference ? track.start : track.reference;
  const to = beforeReference ? track.reference : track.current;
  const span = beforeReference ? REFERENCE_INDEX : LAST_INDEX - REFERENCE_INDEX;
  const local = span === 0 ? 0 : (index - (beforeReference ? 0 : REFERENCE_INDEX)) / span;
  const trend = from + (to - from) * local;
  const noise = Math.sin(Math.PI * local) * Math.sin(index * 2.3 + phase) * track.wobble;
  return round1(trend + noise);
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Left and right differ slightly, and stay symmetric around the tracked mean. */
const pair = (value: number, spread: number): [number, number] => [
  round1(value - spread),
  round1(value + spread),
];

function measurementAt(index: number): BodyMeasurement {
  const arm = valueAt(TRACKS.upperArmCm, index, 1.1);
  const thigh = valueAt(TRACKS.thighCm, index, 2.4);
  const calf = valueAt(TRACKS.calfCm, index, 3.7);
  const [upperArmLeftCm, upperArmRightCm] = pair(arm, 0.3);
  const [thighLeftCm, thighRightCm] = pair(thigh, 0.4);
  const [calfLeftCm, calfRightCm] = pair(calf, 0.2);

  return {
    date: dateAt(index),
    weightKg: valueAt(TRACKS.weightKg, index, 0.4),
    neckCm: valueAt(TRACKS.neckCm, index, 0.9),
    chestCm: valueAt(TRACKS.chestCm, index, 1.8),
    waistCm: valueAt(TRACKS.waistCm, index, 0.2),
    hipCm: valueAt(TRACKS.hipCm, index, 2.9),
    upperArmLeftCm,
    upperArmRightCm,
    thighLeftCm,
    thighRightCm,
    calfLeftCm,
    calfRightCm,
    bodyFatPct: valueAt(TRACKS.bodyFatPct, index, 1.5),
    muscleKg: valueAt(TRACKS.muscleKg, index, 2.1),
    bodyWaterPct: valueAt(TRACKS.bodyWaterPct, index, 3.2),
    boneKg: valueAt(TRACKS.boneKg, index, 0),
    compositionSource: "BIA",
  };
}

/** Oldest first, matching how the weight chart consumes its points. */
export const MOCK_MEASUREMENTS: BodyMeasurement[] = Array.from(
  { length: LAST_INDEX + 1 },
  (_unused, index) => measurementAt(index),
);

/** Index of the 12 May session, the default reference in the preview. */
export const MOCK_REFERENCE_INDEX = REFERENCE_INDEX;
