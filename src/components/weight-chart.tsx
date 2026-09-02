import { getTranslations } from "next-intl/server";
import { movingAverage, weightStats, type WeightPoint } from "@/lib/weight";
import { weightSummary } from "./weight-summary";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

/**
 * Inline SVG so no charting library is needed. The chart is labelled with an
 * accessible summary; the same data is available as a table in the weight log.
 */
export async function WeightChart({
  points,
  goalKg,
  locale,
}: {
  points: WeightPoint[];
  goalKg: number | null;
  locale: Locale;
}) {
  const t = await getTranslations("progress");
  const stats = weightStats(points);
  if (!stats || points.length < 2) return null;

  const averages = movingAverage(points, 7);
  const candidates = [stats.min, stats.max, ...(goalKg ? [goalKg] : [])];
  const rawMin = Math.min(...candidates);
  const rawMax = Math.max(...candidates);
  const pad = Math.max((rawMax - rawMin) * 0.15, 0.5);
  const min = rawMin - pad;
  const max = rawMax + pad;

  const x = (index: number) =>
    PAD.left + (index / Math.max(points.length - 1, 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) =>
    PAD.top + (1 - (value - min) / (max - min)) * (HEIGHT - PAD.top - PAD.bottom);

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.weightKg)}`).join(" ");
  const trendPoints = averages
    .map((value, index) => (value === null ? null : `${x(index)},${y(value)}`))
    .filter((value): value is string => value !== null);

  const summary = await weightSummary(points, locale);

  return (
    <div className="table-scroll">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={summary ?? undefined}
        style={{ minWidth: 320, display: "block" }}
      >
        {[min, (min + max) / 2, max].map((value) => (
          <g key={value}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} stroke="var(--line)" strokeWidth="1" />
            <text x={4} y={y(value) + 4} fontSize="11" fill="var(--text-muted)">
              {formatNumber(value, locale, 0)}
            </text>
          </g>
        ))}

        {goalKg !== null && goalKg >= min && goalKg <= max ? (
          <>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(goalKg)}
              y2={y(goalKg)}
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <text x={WIDTH - PAD.right} y={y(goalKg) - 5} fontSize="11" fill="var(--accent)" textAnchor="end">
              {t("goalLine")}
            </text>
          </>
        ) : null}

        <path d={line} fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
        {trendPoints.length > 1 ? (
          <polyline points={trendPoints.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
        ) : null}

        {points.map((point, index) => (
          <circle key={point.date} cx={x(index)} cy={y(point.weightKg)} r="2.5" fill="var(--text-muted)" />
        ))}
      </svg>
    </div>
  );
}
