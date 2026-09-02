export interface WeightPoint {
  date: string;
  weightKg: number;
}

/**
 * Trailing simple moving average. Returns null until the window is full, so a
 * short history never produces a misleadingly smooth line.
 */
export function movingAverage(points: WeightPoint[], window = 7): (number | null)[] {
  return points.map((_, index) => {
    if (index + 1 < window) return null;
    const slice = points.slice(index + 1 - window, index + 1);
    return slice.reduce((sum, point) => sum + point.weightKg, 0) / window;
  });
}

export interface WeightStats {
  min: number;
  max: number;
  first: WeightPoint;
  last: WeightPoint;
  changeKg: number;
}

export function weightStats(points: WeightPoint[]): WeightStats | null {
  if (points.length === 0) return null;
  const values = points.map((p) => p.weightKg);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    first: points[0],
    last: points[points.length - 1],
    changeKg: points[points.length - 1].weightKg - points[0].weightKg,
  };
}

/**
 * Whether enough points carry a moving average to draw a trend line. A single
 * averaged point would render as nothing, so two are required.
 */
export function hasTrendLine(points: WeightPoint[], window = 7): boolean {
  return movingAverage(points, window).filter((value) => value !== null).length > 1;
}
