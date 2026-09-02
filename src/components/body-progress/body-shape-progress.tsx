"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDelta, formatMeasure, type BodyMeasurement } from "@/lib/body-metrics";
import {
  BODY_VIEW,
  bodyRegionGeometry,
  buildBodyOutline,
  changeIntensity,
  clipShapes,
  outlineInput,
  outlineShapes,
  type BodyClipGroup,
  type BodyRegionKey,
} from "@/lib/body-visualization";
import { REGION_METRIC, regionChanges } from "./body-region-data";
import { BodyOverlayLegend } from "./body-value";

/**
 * Schematic silhouette drawn from recorded circumferences, current over
 * reference, with a change treatment per region. It is deliberately neutral:
 * no photograph, no gendered figure, no body-type label.
 *
 * The figure is a picture; every value it encodes is also written out in the
 * region list beside it, which is where keyboard and screen-reader users
 * interact with the regions.
 */
export function BodyShapeProgress({
  current,
  reference,
  locale,
  referenceLabel,
  active,
  onActive,
}: {
  current: BodyMeasurement;
  reference: BodyMeasurement;
  locale: Locale;
  referenceLabel: string;
  active: BodyRegionKey | null;
  onActive: (region: BodyRegionKey | null) => void;
}) {
  const t = useTranslations("bodyProgress");
  const id = useId();
  const hatchId = `${id}-hatch`;

  const currentInput = outlineInput(current);
  const outline = buildBodyOutline(currentInput);
  const referenceOutline = buildBodyOutline(outlineInput(reference));
  const regions = bodyRegionGeometry(currentInput);
  const changes = regionChanges(current, reference);

  const clipGroups: BodyClipGroup[] = ["body", "arms"];
  const clipIdFor = (group: BodyClipGroup) => `${id}-clip-${group}`;
  const fadeIdFor = (key: string) => `${id}-fade-${key}`;
  /** Bands that changed; the rest of the figure stays untinted. */
  const tinted = regions.filter((region) => {
    const delta = changes[region.key].delta;
    return delta != null && delta.direction !== "flat";
  });
  const bandBounds = (region: (typeof regions)[number]) => {
    const top = Math.min(...region.rects.map((rect) => rect.y));
    const bottom = Math.max(...region.rects.map((rect) => rect.y + rect.height));
    return { top, bottom };
  };

  return (
    <figure className="body-figure body-shape-wrap">
      <svg viewBox={`0 0 ${BODY_VIEW.width} ${BODY_VIEW.height}`} role="img" aria-label={t("shape.chartLabel")}>
        <defs>
          {/* One clip path per body part, so a band never tints a neighbour. */}
          {clipGroups.map((group) => (
            <clipPath key={group} id={clipIdFor(group)}>
              {clipShapes(outline, group).map((d, index) => (
                <path key={index} d={d} />
              ))}
            </clipPath>
          ))}
          {/* A decrease is hatched and an increase is filled, so the two
              directions stay distinguishable without relying on hue. */}
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--info-text)" strokeWidth="2.4" />
          </pattern>

          {/* Bands fade out at their top and bottom edges. A hard rectangle
              would read as a zone diagram rather than as a change in shape. */}
          {tinted.map((region) => {
            const { top, bottom } = bandBounds(region);
            return (
              <mask key={region.key} id={fadeIdFor(region.key)} maskUnits="userSpaceOnUse">
                <linearGradient
                  id={`${fadeIdFor(region.key)}-g`}
                  gradientUnits="userSpaceOnUse"
                  x1="0"
                  y1={top}
                  x2="0"
                  y2={bottom}
                >
                  <stop offset="0" stopColor="#fff" stopOpacity="0" />
                  <stop offset="0.3" stopColor="#fff" stopOpacity="1" />
                  <stop offset="0.7" stopColor="#fff" stopOpacity="1" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <rect
                  x="0"
                  y={top}
                  width={BODY_VIEW.width}
                  height={bottom - top}
                  fill={`url(#${fadeIdFor(region.key)}-g)`}
                />
              </mask>
            );
          })}
        </defs>

        {/* Current body: filled base, then the change bands, then its own outline. */}
        <g fill="var(--surface-2)">
          {outlineShapes(outline).map((d, index) => (
            <path key={index} d={d} />
          ))}
        </g>

        {tinted.map((region) => {
          const delta = changes[region.key].delta!;
          const opacity = changeIntensity(delta.percent);
          const fill = delta.direction === "up" ? "var(--carb)" : `url(#${hatchId})`;
          return (
            <g
              key={region.key}
              clipPath={`url(#${clipIdFor(region.clip)})`}
              mask={`url(#${fadeIdFor(region.key)})`}
              opacity={active === region.key ? Math.min(opacity + 0.22, 0.9) : opacity}
            >
              {region.rects.map((rect, index) => (
                <rect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={fill} />
              ))}
            </g>
          );
        })}

        <g fill="none" stroke="var(--accent)" strokeWidth="2">
          {outlineShapes(outline).map((d, index) => (
            <path key={index} d={d} />
          ))}
        </g>

        {/* Reference body: thin and dashed, drawn last so it stays readable. */}
        <g fill="none" stroke="var(--text-muted)" strokeWidth="1.4" strokeDasharray="5 4" opacity="0.8">
          {outlineShapes(referenceOutline).map((d, index) => (
            <path key={index} d={d} />
          ))}
        </g>

        {tinted.map((region) => {
          const delta = changes[region.key].delta!;
          const swatchX = region.label.anchor === "start" ? region.label.x - 13 : region.label.x + 5;
          return (
            <g key={region.key} opacity={active === null || active === region.key ? 1 : 0.45}>
              <rect
                x={swatchX}
                y={region.label.y - 8}
                width="9"
                height="9"
                rx="2"
                fill={delta.direction === "up" ? "var(--carb)" : `url(#${hatchId})`}
                stroke="var(--line-strong)"
                strokeWidth="0.8"
              />
              <text
                x={region.label.x}
                y={region.label.y}
                textAnchor={region.label.anchor}
                fontSize="12"
                fontWeight="650"
                fill={active === region.key ? "var(--text)" : "var(--text-muted)"}
              >
                {`${formatDelta(delta.absolute, locale, 1)} ${t("unit.cm")}`}
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

      <BodyOverlayLegend referenceLabel={referenceLabel} />
      <figcaption className="body-caption">{t("shape.caption")}</figcaption>
    </figure>
  );
}

/** Text equivalent of the figure, used by the card as its accessible summary. */
export function useBodyShapeSummary(
  current: BodyMeasurement,
  reference: BodyMeasurement,
  referenceLabel: string,
  locale: Locale,
) {
  const t = useTranslations("bodyProgress");
  const changes = regionChanges(current, reference);
  const moved = (Object.keys(REGION_METRIC) as BodyRegionKey[]).filter(
    (key) => changes[key].delta && changes[key].delta!.direction !== "flat",
  );
  if (moved.length === 0) return t("shape.noChanges");

  const sentences = moved.map((key) => {
    const delta = changes[key].delta!;
    return t("shape.summaryItem", {
      region: t(`region.${key}`),
      direction: delta.direction === "up" ? t("shape.increased") : t("shape.decreased"),
      amount: formatMeasure(Math.abs(delta.absolute), locale, 1),
      unit: t("unit.cm"),
    });
  });

  return `${t("shape.summaryIntro", { date: referenceLabel })} ${sentences.join(", ")}.`;
}
