"use client";

import { useState } from "react";
import type { Locale } from "@/i18n/locales";
import { formatDate } from "@/lib/format";
import { latestIndex, type BodyMeasurement, type BodyProfile } from "@/lib/body-metrics";
import type { BodyRegionKey } from "@/lib/body-visualization";
import { BodyMeasurementChart } from "./body-measurement-chart";
import { BodyMeasurementTable } from "./body-measurement-table";
import { BodyMetricSummary } from "./body-metric-summary";
import { BodyProgressCard } from "./body-progress-card";

/**
 * Holds the two indices the whole preview is derived from. Reference and
 * current are the only state: every delta, polygon and label on the page is a
 * function of that pair, which is what makes the reference selector feel like
 * it changes the entire page at once.
 */
export function BodyProgressPreview({
  measurements,
  profile,
  defaultReferenceIndex,
  locale,
}: {
  measurements: BodyMeasurement[];
  profile: BodyProfile;
  defaultReferenceIndex: number;
  locale: Locale;
}) {
  const [currentIndex, setCurrentIndex] = useState(() => latestIndex(measurements));
  const [referenceIndex, setReferenceIndex] = useState(defaultReferenceIndex);
  const [activeRegion, setActiveRegion] = useState<BodyRegionKey | null>(null);

  /** A reference must stay older than the current session it is compared with. */
  function selectCurrent(index: number) {
    setCurrentIndex(index);
    setReferenceIndex((reference) => (reference < index ? reference : Math.max(index - 1, 0)));
  }

  function selectReference(index: number) {
    setReferenceIndex(Math.min(index, Math.max(currentIndex - 1, 0)));
  }

  const referenceLabel = formatDate(measurements[referenceIndex].date, locale);

  return (
    <div className="stack">
      <BodyProgressCard
        measurements={measurements}
        referenceIndex={referenceIndex}
        currentIndex={currentIndex}
        onReferenceIndex={selectReference}
        activeRegion={activeRegion}
        onActiveRegion={setActiveRegion}
        referenceLabel={referenceLabel}
        locale={locale}
      />

      <BodyMetricSummary
        current={measurements[currentIndex]}
        reference={measurements[referenceIndex]}
        profile={profile}
        referenceLabel={referenceLabel}
        locale={locale}
      />

      <BodyMeasurementChart
        measurements={measurements}
        referenceIndex={referenceIndex}
        currentIndex={currentIndex}
        onCurrentIndex={selectCurrent}
        locale={locale}
      />

      <BodyMeasurementTable
        current={measurements[currentIndex]}
        reference={measurements[referenceIndex]}
        referenceLabel={referenceLabel}
        locale={locale}
      />
    </div>
  );
}
