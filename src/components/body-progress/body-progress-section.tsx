"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDate } from "@/lib/format";
import {
  indexNearestDaysBefore,
  latestIndex,
  type BodyMeasurement,
  type BodyProfile,
} from "@/lib/body-metrics";
import type { BodyAppearance, BodyRegionKey } from "@/lib/body-visualization";
import { BodyFigurePicker } from "./body-figure-picker";
import { BodyMeasurementChart } from "./body-measurement-chart";
import { BodyMeasurementTable } from "./body-measurement-table";
import { BodyMetricSummary } from "./body-metric-summary";
import { BodyProgressCard } from "./body-progress-card";

/**
 * Holds the two indices the whole section is derived from. Reference and
 * current are the only state: every delta, polygon and label is a function of
 * that pair, which is what makes the reference selector feel like it changes
 * the entire section at once.
 */
export function BodyProgressSection({
  measurements,
  profile,
  appearance,
  checkin,
  locale,
}: {
  measurements: BodyMeasurement[];
  profile: BodyProfile;
  appearance: BodyAppearance;
  /** The check-in dialog, rendered by the page so it sits in the card head. */
  checkin: React.ReactNode;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const [currentIndex, setCurrentIndex] = useState(() => latestIndex(measurements));
  /* Four weeks back by default: a week-on-week delta is mostly noise, and the
     selector is right there for anyone who wants a different span. */
  const [referenceIndex, setReferenceIndex] = useState(() =>
    indexNearestDaysBefore(measurements, latestIndex(measurements), 28),
  );
  const [activeRegion, setActiveRegion] = useState<BodyRegionKey | null>(null);

  /** A reference must stay older than the current session it is compared with. */
  function selectCurrent(index: number) {
    setCurrentIndex(index);
    setReferenceIndex((reference) => (reference < index ? reference : Math.max(index - 1, 0)));
  }

  function selectReference(index: number) {
    setReferenceIndex(Math.min(index, Math.max(currentIndex - 1, 0)));
  }

  /* One session cannot be compared with anything, so nothing is presented as a
     change until there are two. */
  const hasReference = currentIndex > 0;
  const referenceLabel = formatDate(measurements[referenceIndex].date, locale);
  const actions = (
    <span className="body-card-actions">
      <BodyFigurePicker key="figure" appearance={appearance} locale={locale} />
      <span key="checkin">{checkin}</span>
    </span>
  );

  return (
    <div className="stack body-progress-stack">
      <BodyProgressCard
        measurements={measurements}
        referenceIndex={referenceIndex}
        currentIndex={currentIndex}
        onReferenceIndex={selectReference}
        activeRegion={activeRegion}
        onActiveRegion={setActiveRegion}
        referenceLabel={referenceLabel}
        appearance={appearance}
        hasReference={hasReference}
        figurePicker={actions}
        locale={locale}
      />

      <BodyMetricSummary
        current={measurements[currentIndex]}
        reference={measurements[hasReference ? referenceIndex : currentIndex]}
        profile={profile}
        referenceLabel={referenceLabel}
        hasReference={hasReference}
        locale={locale}
      />

      {measurements.length > 1 ? (
        <BodyMeasurementChart
          measurements={measurements}
          referenceIndex={referenceIndex}
          currentIndex={currentIndex}
          onCurrentIndex={selectCurrent}
          locale={locale}
        />
      ) : null}

      <BodyMeasurementTable
        current={measurements[currentIndex]}
        reference={measurements[hasReference ? referenceIndex : currentIndex]}
        referenceLabel={referenceLabel}
        hasReference={hasReference}
        locale={locale}
      />

      <p className="body-caption">{t("figure.disclaimer")}</p>
    </div>
  );
}
