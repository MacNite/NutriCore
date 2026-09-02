"use client";

import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDelta, formatMeasure, type BodyMeasurement } from "@/lib/body-metrics";
import { BODY_REGIONS, type BodyRegionKey } from "@/lib/body-visualization";
import { regionChanges } from "./body-region-data";
import { DeltaText } from "./body-value";

const SWATCH: Record<"up" | "down" | "flat", string> = {
  up: "body-swatch-up",
  down: "body-swatch-down",
  flat: "body-swatch-flat",
};

/**
 * The legend and the written form of the silhouette's change treatment. It is
 * also the keyboard path into the figure: focusing a row highlights the region.
 */
export function BodyChangeHeatmap({
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
  const changes = regionChanges(current, reference);
  const activeChange = active ? changes[active] : null;

  return (
    <div className="body-change-block">
      <p className="body-micro-head">{t("change.microHead")}</p>

      <ul className="body-region-list">
        {BODY_REGIONS.map((key) => {
          const change = changes[key];
          const direction = change.delta?.direction ?? "flat";
          return (
            <li key={key}>
              <button
                type="button"
                className="body-region-row"
                aria-pressed={active === key}
                onClick={() => onActive(active === key ? null : key)}
                onMouseEnter={() => onActive(key)}
                onMouseLeave={() => onActive(null)}
                onFocus={() => onActive(key)}
                onBlur={() => onActive(null)}
              >
                <span className={`body-swatch ${SWATCH[direction]}`} aria-hidden="true" />
                <span className="body-region-name">{t(`region.${key}`)}</span>
                <span className="body-region-value">
                  {change.value == null ? "–" : `${formatMeasure(change.value, locale, change.digits)} ${t("unit.cm")}`}
                </span>
                <DeltaText
                  delta={change.delta}
                  unit={t("unit.cm")}
                  locale={locale}
                  digits={change.digits}
                  className="body-region-delta"
                />
              </button>
            </li>
          );
        })}
      </ul>

      <p className="body-detail" aria-live="polite">
        {activeChange && activeChange.value != null ? (
          <>
            <strong>
              {`${t(`region.${activeChange.key}`)} · ${formatMeasure(activeChange.value, locale, activeChange.digits)} ${t("unit.cm")}`}
            </strong>
            <span>
              <DeltaText delta={activeChange.delta} unit={t("unit.cm")} locale={locale} digits={activeChange.digits} />
              {activeChange.delta?.percent == null
                ? ""
                : ` · ${formatDelta(activeChange.delta.percent, locale, 1)} ${t("unit.percent")}`}
              {` · ${t("summary.sinceReference", { date: referenceLabel })}`}
            </span>
          </>
        ) : (
          <span>{t("shape.hint")}</span>
        )}
      </p>

      <p className="body-caption">{t("change.legendHint")}</p>
    </div>
  );
}
