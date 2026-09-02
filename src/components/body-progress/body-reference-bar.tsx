"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDate } from "@/lib/format";
import { indexNearestDaysBefore, type BodyMeasurement } from "@/lib/body-metrics";

const QUICK: { key: "first" | "weeks4" | "months3" | "months6" | "year1"; days: number | null }[] = [
  { key: "first", days: null },
  { key: "weeks4", days: 28 },
  { key: "months3", days: 91 },
  { key: "months6", days: 182 },
  { key: "year1", days: 365 },
];

/**
 * Every delta on the page is measured against the session chosen here, so the
 * control sits at the top of the hero card rather than inside one chart.
 */
export function BodyReferenceBar({
  measurements,
  referenceIndex,
  currentIndex,
  onReferenceIndex,
  locale,
}: {
  measurements: BodyMeasurement[];
  referenceIndex: number;
  currentIndex: number;
  onReferenceIndex: (index: number) => void;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const selectId = useId();
  const current = measurements[currentIndex];

  return (
    <div className="body-ref-bar">
      <div className="body-ref-field">
        <label className="label" htmlFor={selectId}>
          {t("reference")}
        </label>
        <select
          id={selectId}
          value={referenceIndex}
          onChange={(event) => onReferenceIndex(Number(event.target.value))}
        >
          {measurements.slice(0, Math.max(currentIndex, 1)).map((measurement, index) => (
            <option key={measurement.date} value={index}>
              {formatDate(measurement.date, locale)}
            </option>
          ))}
        </select>
      </div>

      <div className="body-ref-field">
        <span className="label">{t("current")}</span>
        <span className="body-ref-current">{formatDate(current.date, locale)}</span>
      </div>

      <div className="body-ref-quick" role="group" aria-label={t("quick.label")}>
        {QUICK.map((choice) => {
          const index =
            choice.days === null ? 0 : indexNearestDaysBefore(measurements, currentIndex, choice.days);
          return (
            <button
              key={choice.key}
              type="button"
              className="progress-chip"
              aria-pressed={referenceIndex === index}
              onClick={() => onReferenceIndex(index)}
            >
              {t(`quick.${choice.key}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
