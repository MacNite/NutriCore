"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDate, formatNumber, formatNutrient } from "@/lib/format";
import {
  BODY_METRIC_BY_KEY,
  daysBetween,
  deltaBetween,
  formatDelta,
  formatMeasure,
  metricValue,
  bodyMassIndex,
  type BodyMeasurement,
  type BodyProfile,
  type BodySeriesMetricKey,
} from "@/lib/body-metrics";
import { NUTRIENT_BY_KEY } from "@/lib/nutrients";
import type { NutritionProgressPoint } from "@/lib/nutrition-progress";
import {
  ACTIVITY_SERIES,
  MACRO_KEYS,
  NUTRITION_SERIES,
  activitySeriesPoints,
  availableMicros,
  axisScale,
  axesFor,
  bodySeriesPoints,
  expandSelection,
  isActivitySeries,
  isNutritionSeries,
  isOverLimit,
  nutritionSeriesPoints,
  toggleSeries,
  trailingAverage,
  withinRange,
  type ActivityDayPoint,
  type AxisKey,
  type ProgressSeriesKey,
  type Scale,
  type SeriesPoint,
} from "@/lib/progress-series";
import { UNIT_KEY } from "./body-value";

/* Sized for the full-width preview card, so a wide screen shows the chart at
   its natural scale instead of letterboxing it. */
const WIDTH = 760;
const HEIGHT = 285;
const PAD = { top: 22, bottom: 34, left: 54, right: 18, rightAxis: 56 };

/* One colour per drawn line. The legend names every line anyway, so colour is
   never the only label. */
const COLORS = ["var(--accent)", "var(--focus)", "var(--carb)", "var(--fat)", "var(--danger)"];

/* The macros keep the colours they wear elsewhere in the app, so a brown line
   is carbohydrate here exactly as a brown bar is carbohydrate in the diary. */
const NUTRIENT_COLORS: Record<string, string> = {
  protein: "var(--accent)",
  carbohydrate: "var(--carb)",
  fat: "var(--fat)",
};

/** Colours in drawing order, with the fixed ones claimed before the rest are handed out. */
function assignColors(ids: string[]): string[] {
  const fixed = ids.map((id) => NUTRIENT_COLORS[id] ?? null);
  const taken = new Set(fixed.filter((color): color is string => color !== null));
  const free = COLORS.filter((color) => !taken.has(color));
  let next = 0;
  return fixed.map((color) => color ?? (free.length === 0 ? COLORS[next++ % COLORS.length] : free[next++ % free.length]));
}

const RANGES: { key: "m1" | "m3" | "m6" | "y1" | "all"; days: number | null }[] = [
  { key: "m1", days: 31 },
  { key: "m3", days: 92 },
  { key: "m6", days: 183 },
  { key: "y1", days: 365 },
  { key: "all", days: null },
];

/** Enough of next-intl's translator to name a point out loud. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A line, ready to draw: its points, its scale, and how to name a value. */
interface DrawnSeries {
  id: string;
  chip: ProgressSeriesKey;
  axis: AxisKey;
  label: string;
  color: string;
  digits: number;
  unit: string;
  deltaUnit: string;
  metric?: BodySeriesMetricKey;
  nutrient?: string;
  activity?: true;
  points: SeriesPoint[];
}

/**
 * The one time chart on the progress page: body measurements, daily target
 * attainment and the calories sport and activity added, on a single time axis,
 * several at once.
 *
 * Any number of chips can be on together. Series that share a unit share a
 * scale, and at most two scales are drawn — one on each side — because a third
 * would have no edge to be labelled against and no honest way to be read.
 * The reference session is marked, and selecting a measured point promotes it
 * to "current".
 */
export function BodyMeasurementChart({
  measurements,
  referenceIndex,
  currentIndex,
  onCurrentIndex,
  metrics,
  nutritionPoints,
  activityPoints = [],
  profile,
  locale,
}: {
  /** The measurement sessions, oldest first. Empty when only nutrition is charted. */
  measurements: BodyMeasurement[];
  referenceIndex: number;
  currentIndex: number;
  onCurrentIndex?: (index: number) => void;
  /** The body metrics offered as chips, already narrowed to the switched-on panels. */
  metrics: BodySeriesMetricKey[];
  /** One point per diary day, as a share of that day's targets. */
  nutritionPoints: NutritionProgressPoint[];
  /** One point per day with recorded sport or activity, in active kilocalories. */
  activityPoints?: ActivityDayPoint[];
  profile: BodyProfile | null;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const nt = useTranslations("progress.nutrition");
  const at = useTranslations("progress.activity");

  const microKeys = useMemo(() => availableMicros(nutritionPoints), [nutritionPoints]);
  /* Nutrition sits between the two body figures it belongs with: what the body
     is, then what went into it, then how it is shaped. */
  const chips: ProgressSeriesKey[] = useMemo(() => {
    const body = [...metrics];
    const nutrition: ProgressSeriesKey[] = nutritionPoints.length > 0 ? [...NUTRITION_SERIES] : [];
    /* What sport added to a day reads against what was eaten that day, so the
       activity chip sits at the end of that group rather than among the body
       measurements. */
    if (activityPoints.length > 0) nutrition.push(ACTIVITY_SERIES);
    const after = body.indexOf("bmi") + 1;
    return after > 0 ? [...body.slice(0, after), ...nutrition, ...body.slice(after)] : [...body, ...nutrition];
  }, [metrics, nutritionPoints.length, activityPoints.length]);

  const [selection, setSelection] = useState<ProgressSeriesKey[]>(() => chips.slice(0, 1));
  const [enabledMacros, setEnabledMacros] = useState<string[]>(MACRO_KEYS);
  const [selectedMicros, setSelectedMicros] = useState<string[]>(() => microKeys.slice(0, 3));
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");
  const [active, setActive] = useState<{ id: string; date: string } | null>(null);

  const hasBody = measurements.length > 0;
  const days = RANGES.find((entry) => entry.key === range)?.days ?? null;

  /* The window is measured back from the newest data of any kind, so switching
     a chip does not slide the range under the reader. */
  const lastDate = useMemo(() => {
    const dates = [measurements.at(-1)?.date, nutritionPoints.at(-1)?.date, activityPoints.at(-1)?.date].filter(
      (date): date is string => !!date,
    );
    return dates.length === 0 ? null : dates.sort().at(-1)!;
  }, [measurements, nutritionPoints, activityPoints]);

  const series = useMemo<DrawnSeries[]>(() => {
    const sources = expandSelection(selection, enabledMacros, selectedMicros);
    const colors = assignColors(sources.map((source) => source.id));
    return sources
      .map((source, index) => {
        const color = colors[index];
        if (source.metric) {
          const def =
            source.metric === "bmi"
              ? { unit: null, deltaUnit: null, digits: 1 }
              : BODY_METRIC_BY_KEY.get(source.metric)!;
          return {
            ...source,
            color,
            label: t(`metric.${source.metric}`),
            digits: def.digits,
            unit: def.unit ? t(UNIT_KEY[def.unit]) : "",
            deltaUnit: def.deltaUnit ? t(UNIT_KEY[def.deltaUnit]) : "",
            points: withinRange(bodySeriesPoints(measurements, source.metric, profile), lastDate, days),
          };
        }
        if (source.activity) {
          return {
            ...source,
            color,
            label: at("label"),
            digits: 0,
            unit: at("unit"),
            deltaUnit: at("unit"),
            points: withinRange(activitySeriesPoints(activityPoints), lastDate, days),
          };
        }
        const nutrient = NUTRIENT_BY_KEY.get(source.nutrient!);
        return {
          ...source,
          color,
          label: (locale === "de" ? nutrient?.nameDe : nutrient?.nameEn) ?? source.nutrient!,
          digits: 0,
          unit: "%",
          deltaUnit: "%",
          points: withinRange(nutritionSeriesPoints(nutritionPoints, source.nutrient!), lastDate, days),
        };
      })
      .filter((entry) => entry.points.length > 0);
  }, [selection, enabledMacros, selectedMicros, measurements, nutritionPoints, activityPoints, profile, lastDate, days, locale, t, at]);

  /* The weight goal is the one value on this chart that is not measured, so it
     is only drawn where it means something: on the weight scale. */
  const goalKg = selection.includes("weightKg") ? profile?.targetWeightKg ?? null : null;

  const axes = axesFor(selection).filter((axis) => series.some((entry) => entry.axis === axis));
  const leftAxis = axes[0] ?? null;
  const rightAxis = axes[1] ?? null;
  const padRight = rightAxis ? PAD.rightAxis : PAD.right;

  const scales = useMemo(() => {
    const built = new Map<AxisKey, Scale>();
    for (const axis of axes) {
      const own = series.filter((entry) => entry.axis === axis);
      const values = own.flatMap((entry) => entry.points.map((point) => point.value));
      const scale = axisScale(axis, values, own[0]?.digits ?? 1, axis === "weightKg" ? goalKg : null);
      if (scale) built.set(axis, scale);
    }
    return built;
  }, [axes, series, goalKg]);

  const domain = useMemo(() => {
    const dates = series.flatMap((entry) => entry.points.map((point) => point.date)).sort();
    if (dates.length < 2) return null;
    const from = dates[0];
    const to = dates.at(-1)!;
    return { from, to, span: Math.max(daysBetween(from, to), 1) };
  }, [series]);

  if (chips.length === 0) return null;

  const x = (date: string) =>
    PAD.left + (domain ? daysBetween(domain.from, date) / domain.span : 0) * (WIDTH - PAD.left - padRight);
  const y = (axis: AxisKey, value: number) => {
    const scale = scales.get(axis);
    if (!scale || scale.max === scale.min) return PAD.top + (HEIGHT - PAD.top - PAD.bottom) / 2;
    return PAD.top + (1 - (value - scale.min) / (scale.max - scale.min)) * (HEIGHT - PAD.top - PAD.bottom);
  };
  /* Three evenly spaced gridlines, so both scales are labelled on the same
     lines and neither side has to be read against a rule that is not there. */
  const fractions = [1, 0.5, 0];
  const axisValue = (axis: AxisKey, fraction: number) => {
    const scale = scales.get(axis)!;
    return scale.min + (scale.max - scale.min) * fraction;
  };
  /* Active calories name their unit once, on the shortest label of the axis,
     rather than on every gridline where a four-digit day would run into the
     plot. */
  const axisLabel = (axis: AxisKey, value: number, withUnit = false) => {
    if (axis === "target") return `${formatNumber(value, locale, 0)} %`;
    if (axis === "activeKcal") return `${formatNumber(value, locale, 0)}${withUnit ? ` ${at("unit")}` : ""}`;
    return formatMeasure(value, locale, 1);
  };

  /* The reference marks a measurement session, so it is only drawn where a
     measurement is: on a chart of nutrition alone it would mark nothing. */
  const referenceDate =
    hasBody && series.some((entry) => entry.metric) ? measurements[referenceIndex]?.date ?? null : null;
  const referenceInRange =
    referenceDate != null && domain != null && referenceDate >= domain.from && referenceDate <= domain.to;

  const activeSeries = active ? series.find((entry) => entry.id === active.id) ?? null : null;
  const activePoint = activeSeries?.points.find((point) => point.date === active!.date) ?? null;
  const activeDay = activePoint && activeSeries?.nutrient
    ? nutritionPoints.find((point) => point.date === activePoint.date) ?? null
    : null;

  /** The reference value of a body series, for the delta shown under the chart. */
  const referenceValue = (entry: DrawnSeries) => {
    if (!entry.metric || !hasBody) return null;
    const measurement = measurements[referenceIndex];
    if (!measurement) return null;
    return entry.metric === "bmi"
      ? bodyMassIndex(measurement.weightKg, profile?.heightCm ?? null)
      : metricValue(measurement, entry.metric);
  };

  const showsTarget = axes.includes("target");
  const today = nutritionPoints.at(-1);
  const reachedGoals = showsTarget && today ? Object.values(today.percentages).filter((value) => value != null) : [];
  const reached = reachedGoals.filter((value) => value! >= 90 && value! <= 110).length;
  /* Only a lone line can carry a trend of its own without the chart becoming a
     thicket; with several, each line is its own trend. */
  const averages = series.length === 1 && series[0].metric ? trailingAverage(series[0].points.map((point) => point.value)) : null;

  const onlyNutrition = series.length > 0 && series.every((entry) => entry.nutrient);
  const onlyActivity = series.length > 0 && series.every((entry) => entry.activity);
  const readingHint = onlyActivity ? at("hint") : onlyNutrition ? nt("interactionHint") : t("series.hint");
  /* With no body measurement to chart the card is named after whatever it does
     hold, so a chart of activity alone is not headed "Nutrition". */
  const onlyActivityAvailable = metrics.length === 0 && nutritionPoints.length === 0;
  const heading = metrics.length > 0 ? t("series.title") : onlyActivityAvailable ? at("title") : nt("title");
  const subtitle = metrics.length > 0 ? t("series.subtitle") : onlyActivityAvailable ? at("subtitle") : nt("subtitle");
  const emptyMessage =
    selection.includes("micros") && microKeys.length === 0 ? nt("noMicroTargets") : t("series.empty");

  /**
   * The line under the chart for whichever point is being read: a nutrient
   * against its target, active calories against the range's own average, and a
   * measurement against the reference session.
   */
  function activeDetail(entry: DrawnSeries, point: SeriesPoint) {
    if (entry.activity) {
      const average = entry.points.reduce((sum, item) => sum + item.value, 0) / entry.points.length;
      return at("average", { value: formatNumber(average, locale, 0) });
    }
    if (entry.nutrient && activeDay) {
      const coverage = activeDay.coverage[entry.nutrient];
      const note = coverage != null && coverage < 1 ? ` · ${nt("coverage", { value: formatNumber(coverage * 100, locale, 0) })}` : "";
      return `${formatNutrient(activeDay.values[entry.nutrient], locale)} / ${formatNutrient(activeDay.targets[entry.nutrient], locale)} ${nutrientUnit(entry.nutrient)}${note}`;
    }
    const delta = deltaBetween(point.value, referenceValue(entry), entry.digits);
    return t("series.fromReference", {
      delta: delta ? formatDelta(delta.absolute, locale, entry.digits) : "–",
      unit: entry.deltaUnit,
    });
  }

  /**
   * Which scale a line is read against. Two of them are the labelled edges;
   * anything beyond that is drawn on a scale with no edge to be read off, so
   * it states the range it covers here instead of leaving the line unquantified.
   */
  function seriesNote(entry: DrawnSeries) {
    if (entry.axis === leftAxis) return t("series.axisLeft");
    if (entry.axis === rightAxis) return t("series.axisRight");
    const values = series.filter((other) => other.axis === entry.axis).flatMap((other) => other.points.map((point) => point.value));
    const low = Math.min(...values);
    const high = Math.max(...values);
    return entry.nutrient
      ? `${formatNumber(low, locale, 0)}–${formatNumber(high, locale, 0)} %`
      : `${formatMeasure(low, locale, entry.digits)}–${formatMeasure(high, locale, entry.digits)} ${entry.unit}`;
  }

  function toggleNutrient(key: string, current: string[], set: (keys: string[]) => void, limit?: number) {
    if (current.includes(key)) set(current.filter((value) => value !== key));
    else if (!limit || current.length < limit) set([...current, key]);
  }

  return (
    <section className="card" aria-labelledby="body-series-heading">
      <h2 id="body-series-heading">{heading}</h2>
      <p className="muted nutrition-subtitle">{subtitle}</p>

      <div
        className="progress-tabs body-metric-tabs"
        role="group"
        aria-label={metrics.length > 0 ? t("series.selectMetric") : onlyActivityAvailable ? at("title") : nt("selectNutrients")}
      >
        {chips.map((key) => {
          const selected = selection.includes(key);
          const blocked = isOverLimit(selection, key);
          return (
            <button
              key={key}
              type="button"
              className="btn"
              aria-pressed={selected}
              disabled={blocked}
              title={blocked ? t("series.selectionLimit") : undefined}
              onClick={() => {
                setSelection((current) => toggleSeries(current, key));
                setActive(null);
              }}
            >
              {isActivitySeries(key) ? at("label") : isNutritionSeries(key) ? nt(key) : t(`metric.${key}`)}
            </button>
          );
        })}
      </div>
      {/* Nutrition alone is one scale for every nutrient on it, so the note
          about several scales would be about nothing. */}
      {metrics.length > 0 ? <p className="body-series-note">{t("series.multiHint")}</p> : null}

      {selection.includes("macros") ? (
        <div className="progress-filters" role="group" aria-label={nt("selectNutrients")}>
          {MACRO_KEYS.map((key) => (
            <NutrientChip
              key={key}
              label={nutrientName(key, locale)}
              color={series.find((entry) => entry.id === key)?.color ?? "var(--text-muted)"}
              checked={enabledMacros.includes(key)}
              onClick={() => toggleNutrient(key, enabledMacros, setEnabledMacros)}
            />
          ))}
        </div>
      ) : null}

      {selection.includes("micros") && microKeys.length > 0 ? (
        <div className="progress-filters" role="group" aria-label={nt("selectNutrients")}>
          {microKeys.map((key) => (
            <NutrientChip
              key={key}
              label={nutrientName(key, locale)}
              color={series.find((entry) => entry.id === key)?.color ?? "var(--text-muted)"}
              checked={selectedMicros.includes(key)}
              onClick={() => toggleNutrient(key, selectedMicros, setSelectedMicros, 4)}
            />
          ))}
        </div>
      ) : null}

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

      {showsTarget && reachedGoals.length > 0 ? (
        <p className="progress-score">
          <strong>{nt("todayReached", { reached, total: reachedGoals.length })}</strong>
          <span>{nt("balancedHint")}</span>
        </p>
      ) : null}

      {domain === null || leftAxis === null ? (
        <p className="empty">{emptyMessage}</p>
      ) : (
        <figure className="nutrition-chart body-series-chart">
          <div className="table-scroll">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              width="100%"
              height={HEIGHT}
              role="group"
              aria-label={t("series.chartLabel", {
                metrics: series.map((entry) => entry.label).join(", "),
                from: formatDate(domain.from, locale),
                to: formatDate(domain.to, locale),
              })}
              style={{ minWidth: 340, display: "block" }}
            >
              {/* The band the nutrition view calls balanced, drawn on its own scale. */}
              {showsTarget ? (
                <rect
                  x={PAD.left}
                  y={y("target", 110)}
                  width={WIDTH - PAD.left - padRight}
                  height={Math.max(y("target", 90) - y("target", 110), 0)}
                  fill="var(--accent-soft)"
                  opacity="0.55"
                />
              ) : null}

              {fractions.map((fraction) => {
                const yPos = PAD.top + (1 - fraction) * (HEIGHT - PAD.top - PAD.bottom);
                return (
                  <g key={fraction}>
                    <line
                      x1={PAD.left}
                      x2={WIDTH - padRight}
                      y1={yPos}
                      y2={yPos}
                      stroke="var(--line)"
                      strokeWidth="1"
                    />
                    <text x={4} y={yPos + 4} fontSize="11" fill="var(--text-muted)">
                      {axisLabel(leftAxis, axisValue(leftAxis, fraction), fraction === 0)}
                    </text>
                    {rightAxis ? (
                      <text x={WIDTH - 4} y={yPos + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                        {axisLabel(rightAxis, axisValue(rightAxis, fraction), fraction === 0)}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {showsTarget ? (
                <g>
                  <line
                    x1={PAD.left}
                    x2={WIDTH - padRight}
                    y1={y("target", 100)}
                    y2={y("target", 100)}
                    stroke="var(--accent)"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                  />
                  <text
                    x={WIDTH - padRight}
                    y={y("target", 100) - 7}
                    textAnchor="end"
                    fontSize="11"
                    fontWeight="600"
                    fill="var(--accent)"
                  >
                    {nt("targetLine")}
                  </text>
                </g>
              ) : null}

              {goalKg !== null && scales.has("weightKg") ? (
                <g>
                  <line
                    x1={PAD.left}
                    x2={WIDTH - padRight}
                    y1={y("weightKg", goalKg)}
                    y2={y("weightKg", goalKg)}
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                    strokeDasharray="6 4"
                  />
                  <text x={PAD.left + 5} y={y("weightKg", goalKg) - 5} fontSize="11" fill="var(--accent)">
                    {t("series.goalLine")}
                  </text>
                </g>
              ) : null}

              {referenceInRange && referenceDate ? (
                <g>
                  <line
                    x1={x(referenceDate)}
                    x2={x(referenceDate)}
                    y1={PAD.top}
                    y2={HEIGHT - PAD.bottom}
                    stroke="var(--line-strong)"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                  />
                  <text x={x(referenceDate) + 5} y={PAD.top + 10} fontSize="11" fill="var(--text-muted)">
                    {t("series.referenceMarker")}
                  </text>
                </g>
              ) : null}

              {averages ? (
                <polyline
                  points={averages
                    .map((value, index) => (value == null ? null : `${x(series[0].points[index].date)},${y(series[0].axis, value)}`))
                    .filter((value): value is string => value !== null)
                    .join(" ")}
                  fill="none"
                  stroke="var(--line-strong)"
                  strokeWidth="2.5"
                />
              ) : null}

              {series.map((entry) => (
                <g key={entry.id}>
                  <path
                    d={entry.points
                      .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.date)},${y(entry.axis, point.value)}`)
                      .join(" ")}
                    fill="none"
                    stroke={entry.color}
                    strokeWidth="2.5"
                  />
                  {entry.points.map((point) => {
                    const isCurrent = entry.metric != null && point.index === currentIndex;
                    return (
                      <circle
                        key={point.date}
                        cx={x(point.date)}
                        cy={y(entry.axis, point.value)}
                        r={isCurrent ? 6 : 4}
                        fill={isCurrent ? entry.color : "var(--surface)"}
                        stroke={entry.color}
                        strokeWidth={isCurrent ? 3 : 2}
                        tabIndex={0}
                        role="button"
                        aria-label={pointLabel(entry, point, referenceValue(entry), locale, t, nt, at, nutritionPoints)}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setActive({ id: entry.id, date: point.date })}
                        onMouseLeave={() => setActive(null)}
                        onFocus={() => setActive({ id: entry.id, date: point.date })}
                        onBlur={() => setActive(null)}
                        onClick={() => {
                          setActive({ id: entry.id, date: point.date });
                          if (point.index != null) onCurrentIndex?.(point.index);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          if (point.index != null) onCurrentIndex?.(point.index);
                        }}
                      />
                    );
                  })}
                </g>
              ))}

              {[domain.from, domain.to].map((date, index) => (
                <text
                  key={date}
                  x={x(date)}
                  y={HEIGHT - 8}
                  textAnchor={index === 0 ? "start" : "end"}
                  fontSize="11"
                  fill="var(--text-muted)"
                >
                  {formatDate(date, locale, { day: "2-digit", month: "2-digit" })}
                </text>
              ))}
            </svg>
          </div>

          {series.length > 1 ? (
            <ul className="body-legend body-series-legend">
              {series.map((entry) => (
                <li key={entry.id} className="body-legend-item">
                  <span className="series-mark" style={{ background: entry.color }} aria-hidden="true" />
                  {entry.label}
                  {axes.length > 1 ? <span className="muted">{seriesNote(entry)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          <figcaption className="chart-detail" aria-live="polite">
            {activeSeries && activePoint ? (
              <>
                <strong>
                  {`${formatDate(activePoint.date, locale)} · ${activeSeries.label} ${
                    activeSeries.nutrient
                      ? `${formatNumber(activePoint.value, locale, 0)} %`
                      : `${formatMeasure(activePoint.value, locale, activeSeries.digits)} ${activeSeries.unit}`
                  }`}
                </strong>
                <span>{activeDetail(activeSeries, activePoint)}</span>
              </>
            ) : (
              <span>{readingHint}</span>
            )}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

function nutrientName(key: string, locale: Locale) {
  const nutrient = NUTRIENT_BY_KEY.get(key);
  return (locale === "de" ? nutrient?.nameDe : nutrient?.nameEn) ?? key;
}

function nutrientUnit(key: string) {
  return NUTRIENT_BY_KEY.get(key)?.unit ?? "";
}

/** The spoken form of a point, so every value on the chart is readable without it. */
function pointLabel(
  entry: DrawnSeries,
  point: SeriesPoint,
  reference: number | null,
  locale: Locale,
  t: Translate,
  nt: Translate,
  at: Translate,
  nutritionPoints: NutritionProgressPoint[],
) {
  if (entry.activity) {
    return at("pointLabel", { date: formatDate(point.date, locale), value: formatNumber(point.value, locale, 0) });
  }
  if (entry.nutrient) {
    const day = nutritionPoints.find((candidate) => candidate.date === point.date);
    return nt("pointLabel", {
      date: formatDate(point.date, locale),
      nutrient: entry.label,
      percent: formatNumber(point.value, locale, 0),
      value: formatNutrient(day?.values[entry.nutrient], locale),
      target: formatNutrient(day?.targets[entry.nutrient], locale),
      unit: nutrientUnit(entry.nutrient),
    });
  }
  const delta = deltaBetween(point.value, reference, entry.digits);
  return t("series.pointLabel", {
    date: formatDate(point.date, locale),
    metric: entry.label,
    value: formatMeasure(point.value, locale, entry.digits),
    unit: entry.unit,
    delta: delta ? formatDelta(delta.absolute, locale, entry.digits) : "–",
    deltaUnit: entry.deltaUnit,
  });
}

function NutrientChip({
  label,
  color,
  checked,
  onClick,
}: {
  label: string;
  color: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="progress-chip" aria-pressed={checked} onClick={onClick}>
      <span className="series-mark" style={{ background: color }} aria-hidden="true" />
      {label}
    </button>
  );
}
