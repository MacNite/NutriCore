"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDelta, formatMeasure, type BodyMeasurement } from "@/lib/body-metrics";
import {
  MEASURE_VIEW,
  bodyMeasureRows,
  bodyRegionGeometry,
  buildBodyFigure,
  clipShapes,
  outlineInput,
  outlineShapes,
  type BodyAppearance,
  type BodyRegionKey,
} from "@/lib/body-visualization";
import { regionChanges } from "./body-region-data";

/**
 * The measure figure: the same body as the silhouette, holding its arms clear,
 * with a caliper drawn across every level a tape measure was put around. Each
 * caliper carries the marks the reference measurement left, so a change is a
 * distance between two marks rather than a tint that has to be decoded.
 *
 * The drawing is a picture; every value in it is also written out in the region
 * list beside it, which is where keyboard and screen-reader users work.
 */
export function BodyMeasureFigure({
  current,
  reference,
  appearance,
  hasReference,
  locale,
  referenceLabel,
  active,
  onActive,
}: {
  current: BodyMeasurement;
  reference: BodyMeasurement;
  appearance: BodyAppearance;
  hasReference: boolean;
  locale: Locale;
  referenceLabel: string;
  active: BodyRegionKey | null;
  onActive: (region: BodyRegionKey | null) => void;
}) {
  const t = useTranslations("bodyProgress");
  const id = useId();
  const clipId = `${id}-body`;
  const headId = `${id}-head`;
  const tailId = `${id}-tail`;

  const currentInput = outlineInput(current, appearance);
  const figure = buildBodyFigure(currentInput, appearance, "MEASURE");
  const rows = bodyMeasureRows(currentInput, appearance);
  const referenceRows = hasReference
    ? new Map(bodyMeasureRows(outlineInput(reference, appearance), appearance).map((row) => [row.key, row]))
    : null;
  const regions = bodyRegionGeometry(currentInput, appearance, "MEASURE");
  const changes = regionChanges(current, reference);

  return (
    <figure className="body-figure body-measure-wrap">
      <svg
        viewBox={`0 0 ${MEASURE_VIEW.width} ${MEASURE_VIEW.height}`}
        role="img"
        aria-label={t("shape.measureChartLabel")}
      >
        <defs>
          <clipPath id={clipId}>
            {clipShapes(figure.outline, "body").map((d, index) => (
              <path key={index} d={d} />
            ))}
          </clipPath>
          {/* One arrowhead per end, so a caliper reads as a span rather than as
              a line that happens to stop somewhere. */}
          <marker id={headId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M8,0 L0,4 L8,8 Z" fill="var(--accent)" />
          </marker>
          <marker id={tailId} viewBox="0 0 8 8" refX="1" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* The body is the ground here, not the message: it is drawn quietly so
            the calipers on top of it stay the thing being read. */}
        {figure.hairBack ? <path d={figure.hairBack} fill="var(--text-muted)" opacity="0.5" /> : null}

        <g fill="var(--surface-2)">
          {outlineShapes(figure.outline).map((d, index) => (
            <path key={index} d={d} />
          ))}
        </g>

        <g clipPath={`url(#${clipId})`}>
          <path d={figure.briefs} fill="var(--text-muted)" opacity="0.22" />
          {figure.bra ? <path d={figure.bra} fill="var(--text-muted)" opacity="0.22" /> : null}
        </g>

        <g fill="none" stroke="var(--line-strong)" strokeWidth="1.4">
          {outlineShapes(figure.outline).map((d, index) => (
            <path key={index} d={d} />
          ))}
        </g>

        <path d={figure.hairFront} fill="var(--text-muted)" opacity="0.5" />

        {rows.map((row) => {
          const change = changes[row.key];
          const moved = change.delta != null && change.delta.direction !== "flat";
          /* Reference marks only where something moved: on an unchanged level
             they would sit under the caliper's own end bars and add nothing. */
          const previous = moved ? referenceRows?.get(row.key) : undefined;
          const focused = active === row.key;
          const edge = Math.max(row.cx + row.half, previous ? previous.cx + previous.half : 0);
          /* A neck or a calf is too narrow to carry two arrowheads without them
             meeting in the middle, so those spans are ended by their bars. */
          const arrows = row.half * 2 >= 34;

          return (
            <g key={row.key} opacity={active === null || focused ? 1 : 0.5}>
              {previous
                ? [previous.cx - previous.half, previous.cx + previous.half].map((x, side) => (
                    <line
                      key={side}
                      x1={x}
                      y1={row.y - 8}
                      x2={x}
                      y2={row.y + 8}
                      stroke="var(--text-muted)"
                      strokeWidth="1.4"
                    />
                  ))
                : null}

              <line
                x1={row.cx - row.half}
                y1={row.y}
                x2={row.cx + row.half}
                y2={row.y}
                stroke="var(--accent)"
                strokeWidth={focused ? 2.4 : 1.6}
                markerStart={arrows ? `url(#${tailId})` : undefined}
                markerEnd={arrows ? `url(#${headId})` : undefined}
              />
              {[row.cx - row.half, row.cx + row.half].map((x, side) => (
                <line
                  key={side}
                  x1={x}
                  y1={row.y - 5}
                  x2={x}
                  y2={row.y + 5}
                  stroke="var(--accent)"
                  strokeWidth={focused ? 2.4 : 1.6}
                />
              ))}

              <line
                x1={edge + 6}
                y1={row.y}
                x2={MEASURE_VIEW.labelX - 8}
                y2={row.labelY - 4}
                stroke="var(--line-strong)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />

              <text
                x={MEASURE_VIEW.labelX}
                y={row.labelY}
                fontSize="12.5"
                fontWeight="650"
                fill={focused ? "var(--text)" : "var(--text-muted)"}
              >
                {t(`region.${row.key}`)}
              </text>
              <text x={MEASURE_VIEW.labelX} y={row.labelY + 15} fontSize="12" fill="var(--text-muted)">
                {change.value == null
                  ? "–"
                  : `${formatMeasure(change.value, locale, change.digits)} ${t("unit.cm")}`}
                {change.delta ? (
                  <tspan fontWeight="650" dx="6">
                    {formatDelta(change.delta.absolute, locale, change.digits)}
                  </tspan>
                ) : null}
              </text>
            </g>
          );
        })}

        {/* Pointer targets only; the list beside the figure is the keyboard path. */}
        <g aria-hidden="true">
          {regions.map((region) =>
            region.hitRects.map((rect, index) => (
              <rect
                key={`${region.key}-${index}`}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => onActive(region.key)}
                onMouseLeave={() => onActive(null)}
                onClick={() => onActive(region.key)}
              />
            )),
          )}
        </g>
      </svg>

      {hasReference ? (
        <p className="body-legend">
          <span className="body-legend-item">
            <span className="body-legend-line" aria-hidden="true" />
            {t("legend.current")}
          </span>
          <span className="body-legend-item">
            <span className="body-legend-tick" aria-hidden="true" />
            {`${t("legend.reference")} · ${referenceLabel}`}
          </span>
        </p>
      ) : null}
      <figcaption className="body-caption">{t("shape.measureCaption")}</figcaption>
    </figure>
  );
}
