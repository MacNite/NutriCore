"use client";

import { useTranslations } from "next-intl";
import type { Delta, MeasurementSource } from "@/lib/body-metrics";
import { formatDelta } from "@/lib/body-metrics";
import type { Locale } from "@/i18n/locales";

/**
 * Small shared pieces of the body-progress preview: provenance badges and
 * signed changes. Both follow the existing NutriCore rule that meaning is
 * carried by text first and by colour only as reinforcement.
 */

const BADGE_CLASS: Record<MeasurementSource, string> = {
  MANUAL: "",
  BIA: "badge-usda",
  OTHER_DEVICE: "badge-usda",
  OPTICAL_SCAN: "badge-ai",
  ESTIMATE: "badge-ai",
  DERIVED: "badge-off",
};

export function BodySourceBadge({ source }: { source: MeasurementSource }) {
  const t = useTranslations("bodyProgress");
  const full = t(`sourceFull.${source}`);

  return (
    <span className={`badge ${BADGE_CLASS[source]}`.trimEnd()} title={full}>
      {source === "ESTIMATE" || source === "OPTICAL_SCAN" ? <span aria-hidden="true">≈</span> : null}
      {t(`source.${source}`)}
      <span className="sr-only"> — {full}</span>
    </span>
  );
}

/** "+1.1 kg", "−5.8 cm", "±0.0 kg" — the sign is always part of the string. */
export function DeltaText({
  delta,
  unit,
  locale,
  digits = 1,
  className = "",
}: {
  delta: Delta | null;
  unit: string;
  locale: Locale;
  digits?: number;
  className?: string;
}) {
  if (!delta) return <span className={`body-delta ${className}`.trimEnd()}>–</span>;
  const direction = delta.direction === "flat" ? "" : `body-delta-${delta.direction}`;
  return (
    <span className={`body-delta ${direction} ${className}`.replace(/\s+/g, " ").trimEnd()}>
      {formatDelta(delta.absolute, locale, digits)}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

/**
 * Which of the two overlaid shapes is which. Both visualisations draw the
 * reference dashed and the current solid, so one legend describes both.
 */
export function BodyOverlayLegend({ referenceLabel }: { referenceLabel: string }) {
  const t = useTranslations("bodyProgress");
  return (
    <p className="body-legend">
      <span className="body-legend-item">
        <span className="body-legend-line" aria-hidden="true" />
        {t("legend.current")}
      </span>
      <span className="body-legend-item">
        <span className="body-legend-line body-legend-line-reference" aria-hidden="true" />
        {`${t("legend.reference")} · ${referenceLabel}`}
      </span>
    </p>
  );
}

/** Message keys for units, so `t()` keeps its literal-key typing. */
export const UNIT_KEY = {
  kg: "unit.kg",
  cm: "unit.cm",
  "%": "unit.percent",
  pp: "unit.pp",
} as const;
