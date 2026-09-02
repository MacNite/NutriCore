"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import {
  BODY_METRIC_BY_KEY,
  formatMeasure,
  metricDelta,
  metricSource,
  metricValue,
  type BodyMeasurement,
  type BodyMetricKey,
} from "@/lib/body-metrics";
import {
  COMPOSITION_AXES,
  DIAMOND,
  DIAMOND_RINGS,
  axisRatio,
  polarPoint,
  polygonPoints,
  radiusForRatio,
  type CompositionAxisKey,
} from "@/lib/body-visualization";
import { BodyFold } from "./body-fold";
import { BodyOverlayLegend, BodySourceBadge, DeltaText, UNIT_KEY } from "./body-value";

const AXIS_METRIC: Record<CompositionAxisKey, BodyMetricKey> = {
  muscle: "muscleKg",
  water: "bodyWaterPct",
  fat: "bodyFatPct",
  bone: "boneKg",
};

/** Where an axis label sits relative to its vertex, per compass direction. */
const LABEL: Record<CompositionAxisKey, { x: number; y: number; anchor: "middle" | "start" | "end" }> = {
  muscle: { x: DIAMOND.cx, y: DIAMOND.cy - DIAMOND.maxRadius - 30, anchor: "middle" },
  water: { x: DIAMOND.cx + DIAMOND.maxRadius + 12, y: DIAMOND.cy - 6, anchor: "start" },
  fat: { x: DIAMOND.cx, y: DIAMOND.cy + DIAMOND.maxRadius + 22, anchor: "middle" },
  bone: { x: DIAMOND.cx - DIAMOND.maxRadius - 12, y: DIAMOND.cy - 6, anchor: "end" },
};

const ringPolygon = (ratio: number) =>
  polygonPoints(COMPOSITION_AXES.map((axis) => polarPoint(axis.angleDeg, radiusForRatio(ratio))));

/**
 * Four-axis outline of muscle, water, fat and bone. Every axis is normalised
 * against its own reference value, so the shape describes change rather than a
 * score — outward is not "better", and the four values are not shares of a
 * whole, which the caption states explicitly.
 */
export function BodyCompositionDiamond({
  current,
  reference,
  referenceLabel,
  locale,
}: {
  current: BodyMeasurement;
  reference: BodyMeasurement;
  referenceLabel: string;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const [active, setActive] = useState<CompositionAxisKey | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);
  const infoId = useId();
  /* Tapping an axis opens the panel, because that is where its detail line is. */
  const expanded = foldOpen || active !== null;

  const axes = COMPOSITION_AXES.map((axis) => {
    const metric = AXIS_METRIC[axis.key];
    const def = BODY_METRIC_BY_KEY.get(metric)!;
    const value = metricValue(current, metric);
    const ratio = axisRatio(value, metricValue(reference, metric));
    return {
      ...axis,
      metric,
      def,
      value,
      ratio,
      delta: metricDelta(current, reference, metric),
      source: metricSource(current, metric),
      vertex: polarPoint(axis.angleDeg, radiusForRatio(ratio)),
    };
  });

  const activeAxis = axes.find((axis) => axis.key === active) ?? null;

  return (
    <div>
      <p className="body-micro-head">
        {t("composition.microHead")}{" "}
        <button
          type="button"
          className="body-info"
          aria-expanded={infoOpen}
          aria-controls={infoId}
          aria-label={t("composition.infoLabel")}
          onClick={() => setInfoOpen((open) => !open)}
        >
          <span aria-hidden="true">i</span>
        </button>
      </p>
      <p id={infoId} className="body-info-text" hidden={!infoOpen}>
        {t("composition.info")}
      </p>

      <figure className="body-figure body-diamond-wrap">
        <svg
          viewBox={`0 0 ${DIAMOND.width} ${DIAMOND.height}`}
          role="img"
          aria-label={t("composition.chartLabel")}
        >
          {DIAMOND_RINGS.map((ratio) => (
            <polygon key={ratio} points={ringPolygon(ratio)} fill="none" stroke="var(--line)" strokeWidth="1" />
          ))}

          {COMPOSITION_AXES.map((axis) => {
            const end = polarPoint(axis.angleDeg, DIAMOND.maxRadius);
            return (
              <line
                key={axis.key}
                x1={DIAMOND.cx}
                y1={DIAMOND.cy}
                x2={end.x}
                y2={end.y}
                stroke="var(--line)"
                strokeWidth="1"
              />
            );
          })}

          {/* The reference sits at ratio 1 on every axis, so it is a fixed diamond. */}
          <polygon
            points={ringPolygon(1)}
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />

          <polygon
            points={polygonPoints(axes.map((axis) => axis.vertex))}
            fill="var(--accent)"
            fillOpacity="0.18"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />

          {axes.map((axis) => (
            <circle
              key={axis.key}
              cx={axis.vertex.x}
              cy={axis.vertex.y}
              r={active === axis.key ? 6 : 4}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
          ))}

          {axes.map((axis) => {
            const label = LABEL[axis.key];
            return (
              <g key={axis.key}>
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  fontSize="10"
                  fontWeight="700"
                  letterSpacing="0.08em"
                  fill="var(--text-muted)"
                >
                  {t(`composition.axis.${axis.key}`).toLocaleUpperCase(locale)}
                </text>
                <text
                  x={label.x}
                  y={label.y + 16}
                  textAnchor={label.anchor}
                  fontSize="13"
                  fontWeight="650"
                  fill={active === axis.key ? "var(--accent)" : "var(--text)"}
                >
                  {axis.value == null
                    ? "–"
                    : `${formatMeasure(axis.value, locale, axis.def.digits)} ${t(UNIT_KEY[axis.def.unit])}`}
                </text>
              </g>
            );
          })}

          {/* Pointer targets only: the stat buttons below carry the same data
              for keyboard and assistive technology. */}
          <g aria-hidden="true">
            {axes.map((axis) => (
              <circle
                key={axis.key}
                cx={axis.vertex.x}
                cy={axis.vertex.y}
                r="30"
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setActive(axis.key)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(axis.key)}
              />
            ))}
          </g>
        </svg>
      </figure>

      <BodyOverlayLegend referenceLabel={referenceLabel} />

      <BodyFold
        label={t("composition.foldLabel")}
        open={expanded}
        onToggle={() => {
          setFoldOpen(!expanded);
          if (expanded) setActive(null);
        }}
      >
        <div className="body-stat-grid">
          {axes.map((axis) => (
            <button
              key={axis.key}
              type="button"
              className="body-stat"
              aria-pressed={active === axis.key}
              onClick={() => setActive(active === axis.key ? null : axis.key)}
              onMouseEnter={() => setActive(axis.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(axis.key)}
              onBlur={() => setActive(null)}
            >
              <span className="body-stat-name">
                {t(`composition.axis.${axis.key}`)}
                <BodySourceBadge source={axis.source} />
              </span>
              <span className="body-stat-value">
                {axis.value == null
                  ? "–"
                  : `${formatMeasure(axis.value, locale, axis.def.digits)} ${t(UNIT_KEY[axis.def.unit])}`}
              </span>
              <DeltaText
                delta={axis.delta}
                unit={t(UNIT_KEY[axis.def.deltaUnit])}
                locale={locale}
                digits={axis.def.digits}
              />
            </button>
          ))}
        </div>

        <p className="body-detail" aria-live="polite">
          {activeAxis ? (
            <>
              <strong>
                {t(`composition.axis.${activeAxis.key}`)}
                {activeAxis.value == null
                  ? ""
                  : ` · ${formatMeasure(activeAxis.value, locale, activeAxis.def.digits)} ${t(UNIT_KEY[activeAxis.def.unit])}`}
              </strong>
              <span>
                <DeltaText
                  delta={activeAxis.delta}
                  unit={t(UNIT_KEY[activeAxis.def.deltaUnit])}
                  locale={locale}
                  digits={activeAxis.def.digits}
                />
                {` · ${t(`sourceFull.${activeAxis.source}`)}`}
              </span>
            </>
          ) : (
            <span>{t("composition.hint")}</span>
          )}
        </p>

        <p className="body-caption">{t("composition.rings")}</p>
        <p className="body-caption">{t("composition.note")}</p>
      </BodyFold>
    </div>
  );
}
