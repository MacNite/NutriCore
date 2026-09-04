"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDate } from "@/lib/format";
import {
  BODY_METRIC_BY_KEY,
  bodyMassIndex,
  daysBetween,
  deltaBetween,
  formatDelta,
  formatMeasure,
  metricValue,
  type BodyMeasurement,
  type BodyProfile,
  type BodySeriesMetricKey,
} from "@/lib/body-metrics";
import { UNIT_KEY } from "./body-value";

/* Sized for the full-width preview card, so a wide screen shows the chart at
   its natural scale instead of letterboxing it. */
const WIDTH = 760;
const HEIGHT = 270;
const PAD = { top: 18, right: 18, bottom: 32, left: 54 };

const RANGES: { key: "m1" | "m3" | "m6" | "y1" | "all"; days: number | null }[] = [
  { key: "m1", days: 31 },
  { key: "m3", days: 92 },
  { key: "m6", days: 183 },
  { key: "y1", days: 365 },
  { key: "all", days: null },
];

/** Trailing average over three sessions — the weekly analogue of the 7-day line. */
function trailingAverage(values: (number | null)[], window = 3): (number | null)[] {
  return values.map((_unused, index) => {
    if (index + 1 < window) return null;
    const slice = values.slice(index + 1 - window, index + 1);
    if (slice.some((value) => value == null)) return null;
    return (slice as number[]).reduce((sum, value) => sum + value, 0) / window;
  });
}

/**
 * One measurement over time, in the same visual language as the weight chart:
 * inline SVG, gridlines from the tokens, a trend line in the accent colour. The
 * reference session is marked, and selecting a point promotes it to "current".
 */
export function BodyMeasurementChart({
  measurements,
  referenceIndex,
  currentIndex,
  onCurrentIndex,
  metrics,
  profile,
  locale,
}: {
  measurements: BodyMeasurement[];
  referenceIndex: number;
  currentIndex: number;
  onCurrentIndex: (index: number) => void;
  /** The metrics offered as chips, already narrowed to the switched-on panels. */
  metrics: BodySeriesMetricKey[];
  profile: BodyProfile;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  /* The waist leads wherever it is offered; otherwise whatever comes first. */
  const [metric, setMetric] = useState<BodySeriesMetricKey>(() => metrics[0]);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");
  const [active, setActive] = useState<number | null>(null);

  const def = metric === "bmi"
    ? { key: "bmi", unit: "" as const, deltaUnit: "" as const, digits: 1 }
    : BODY_METRIC_BY_KEY.get(metric)!;
  const unit = def.unit ? t(UNIT_KEY[def.unit]) : "";
  const deltaUnit = def.deltaUnit ? t(UNIT_KEY[def.deltaUnit]) : "";
  const referenceValue = metric === "bmi"
    ? bodyMassIndex(measurements[referenceIndex].weightKg, profile.heightCm)
    : metricValue(measurements[referenceIndex], metric);

  const points = useMemo(() => {
    const days = RANGES.find((entry) => entry.key === range)?.days ?? null;
    const lastDate = measurements[measurements.length - 1].date;
    return measurements
      .map((measurement, index) => ({
        index,
        measurement,
        value: metric === "bmi"
          ? bodyMassIndex(measurement.weightKg, profile.heightCm)
          : metricValue(measurement, metric),
      }))
      .filter((point) => point.value != null)
      .filter((point) => days == null || daysBetween(point.measurement.date, lastDate) <= days);
  }, [measurements, metric, range, profile.heightCm]);

  /* The weight goal is the one value on this chart that is not a measurement,
     so it is only drawn where it means something: on the weight series, and
     inside the scale rather than pinned to its edge. */
  const goalKg = metric === "weightKg" ? profile.targetWeightKg : null;

  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((point) => point.value!);
    /* The measured range is what the chart is described as covering; the goal
       only widens the scale so its line has somewhere to sit. */
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const low = goalKg == null ? rawMin : Math.min(rawMin, goalKg);
    const high = goalKg == null ? rawMax : Math.max(rawMax, goalKg);
    const pad = Math.max((high - low) * 0.15, 10 ** -def.digits);
    const min = low - pad;
    const max = high + pad;
    const from = points[0].measurement.date;
    const span = Math.max(daysBetween(from, points[points.length - 1].measurement.date), 1);
    return {
      min,
      max,
      rawMin,
      rawMax,
      x: (date: string) => PAD.left + (daysBetween(from, date) / span) * (WIDTH - PAD.left - PAD.right),
      y: (value: number) => PAD.top + (1 - (value - min) / (max - min)) * (HEIGHT - PAD.top - PAD.bottom),
    };
  }, [points, def.digits, goalKg]);

  const activePoint = points.find((point) => point.index === active) ?? null;
  const referenceInRange = points.some((point) => point.index === referenceIndex);
  const averages = trailingAverage(points.map((point) => point.value));

  return (
    <section className="card" aria-labelledby="body-series-heading">
      <h2 id="body-series-heading">{t("series.title")}</h2>
      <p className="muted nutrition-subtitle">{t("series.subtitle")}</p>

      <div className="progress-tabs body-metric-tabs" role="tablist" aria-label={t("series.selectMetric")}>
        {metrics.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={metric === key}
            className="btn"
            onClick={() => {
              setMetric(key);
              setActive(null);
            }}
          >
            {t(`metric.${key}`)}
          </button>
        ))}
      </div>

      <div className="progress-filters" role="group" aria-label={t("series.selectRange")}>
        {RANGES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="progress-chip"
            aria-pressed={range === entry.key}
            onClick={() => setRange(entry.key)}
          >
            {t(`series.range.${entry.key}`)}
          </button>
        ))}
      </div>

      {chart === null ? (
        <p className="empty">{t("series.empty")}</p>
      ) : (
        <figure className="nutrition-chart body-series-chart">
          <div className="table-scroll">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              width="100%"
              height={HEIGHT}
              role="group"
              aria-label={t("series.chartLabel", {
                metric: t(`metric.${metric}`),
                from: formatDate(points[0].measurement.date, locale),
                to: formatDate(points[points.length - 1].measurement.date, locale),
                min: formatMeasure(chart.rawMin, locale, def.digits),
                max: formatMeasure(chart.rawMax, locale, def.digits),
                unit,
              })}
              style={{ minWidth: 340, display: "block" }}
            >
              {[chart.min, (chart.min + chart.max) / 2, chart.max].map((value) => (
                <g key={value}>
                  <line
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={chart.y(value)}
                    y2={chart.y(value)}
                    stroke="var(--line)"
                    strokeWidth="1"
                  />
                  <text x={4} y={chart.y(value) + 4} fontSize="11" fill="var(--text-muted)">
                    {formatMeasure(value, locale, def.digits)}
                  </text>
                </g>
              ))}

              {goalKg !== null ? (
                <g>
                  <line
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={chart.y(goalKg)}
                    y2={chart.y(goalKg)}
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                    strokeDasharray="6 4"
                  />
                  <text
                    x={WIDTH - PAD.right}
                    y={chart.y(goalKg) - 5}
                    fontSize="11"
                    fill="var(--accent)"
                    textAnchor="end"
                  >
                    {t("series.goalLine")}
                  </text>
                </g>
              ) : null}

              {referenceInRange ? (
                <g>
                  <line
                    x1={chart.x(measurements[referenceIndex].date)}
                    x2={chart.x(measurements[referenceIndex].date)}
                    y1={PAD.top}
                    y2={HEIGHT - PAD.bottom}
                    stroke="var(--line-strong)"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                  />
                  <text
                    x={chart.x(measurements[referenceIndex].date) + 5}
                    y={PAD.top + 10}
                    fontSize="11"
                    fill="var(--text-muted)"
                  >
                    {t("series.referenceMarker")}
                  </text>
                </g>
              ) : null}

              <path
                d={points
                  .map((point, index) => `${index === 0 ? "M" : "L"}${chart.x(point.measurement.date)},${chart.y(point.value!)}`)
                  .join(" ")}
                fill="none"
                stroke="var(--line-strong)"
                strokeWidth="1.5"
              />

              <polyline
                points={averages
                  .map((value, index) => (value == null ? null : `${chart.x(points[index].measurement.date)},${chart.y(value)}`))
                  .filter((value): value is string => value !== null)
                  .join(" ")}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.5"
              />

              {points.map((point) => {
                const isCurrent = point.index === currentIndex;
                const delta = deltaBetween(point.value, referenceValue, def.digits);
                return (
                  <circle
                    key={point.measurement.date}
                    cx={chart.x(point.measurement.date)}
                    cy={chart.y(point.value!)}
                    r={isCurrent ? 6 : 4}
                    fill={isCurrent ? "var(--accent)" : "var(--surface)"}
                    stroke="var(--accent)"
                    strokeWidth={isCurrent ? 3 : 2}
                    tabIndex={0}
                    role="button"
                    aria-label={t("series.pointLabel", {
                      date: formatDate(point.measurement.date, locale),
                      metric: t(`metric.${metric}`),
                      value: formatMeasure(point.value!, locale, def.digits),
                      unit,
                      delta: delta ? formatDelta(delta.absolute, locale, def.digits) : "–",
                      deltaUnit,
                    })}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setActive(point.index)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(point.index)}
                    onBlur={() => setActive(null)}
                    onClick={() => onCurrentIndex(point.index)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onCurrentIndex(point.index);
                      }
                    }}
                  />
                );
              })}

              {[points[0], points[points.length - 1]].map((point, index) => (
                <text
                  key={point.measurement.date}
                  x={chart.x(point.measurement.date)}
                  y={HEIGHT - 8}
                  textAnchor={index === 0 ? "start" : "end"}
                  fontSize="11"
                  fill="var(--text-muted)"
                >
                  {formatDate(point.measurement.date, locale, { day: "2-digit", month: "2-digit" })}
                </text>
              ))}
            </svg>
          </div>

          <figcaption className="chart-detail" aria-live="polite">
            {activePoint ? (
              <>
                <strong>
                  {`${formatDate(activePoint.measurement.date, locale)} · ${t(`metric.${metric}`)} ${formatMeasure(activePoint.value!, locale, def.digits)} ${unit}`}
                </strong>
                <span>
                  {t("series.fromReference", {
                    delta: (() => {
                      const delta = deltaBetween(activePoint.value, referenceValue, def.digits);
                      return delta ? formatDelta(delta.absolute, locale, def.digits) : "–";
                    })(),
                    unit: deltaUnit,
                  })}
                </span>
              </>
            ) : (
              <span>{t("series.hint")}</span>
            )}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
