import {
  BODY_METRIC_BY_KEY,
  metricDelta,
  metricValue,
  type BodyMeasurement,
  type BodyMetricKey,
  type Delta,
} from "@/lib/body-metrics";
import { BODY_REGIONS, type BodyRegionKey } from "@/lib/body-visualization";

/** Which recorded circumference drives each region of the silhouette. */
export const REGION_METRIC: Record<BodyRegionKey, BodyMetricKey> = {
  neck: "neckCm",
  chest: "chestCm",
  waist: "waistCm",
  hip: "hipCm",
  upperArm: "upperArmCm",
  thigh: "thighCm",
  calf: "calfCm",
};

export interface RegionChange {
  key: BodyRegionKey;
  metric: BodyMetricKey;
  value: number | null;
  delta: Delta | null;
  digits: number;
}

/** Current value and change per region, in top-to-bottom reading order. */
export function regionChanges(
  current: BodyMeasurement,
  reference: BodyMeasurement,
): Record<BodyRegionKey, RegionChange> {
  const entries = BODY_REGIONS.map((key) => {
    const metric = REGION_METRIC[key];
    const digits = BODY_METRIC_BY_KEY.get(metric)?.digits ?? 1;
    return [
      key,
      {
        key,
        metric,
        value: metricValue(current, metric),
        delta: metricDelta(current, reference, metric),
        digits,
      },
    ] as const;
  });
  return Object.fromEntries(entries) as Record<BodyRegionKey, RegionChange>;
}
