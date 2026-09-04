"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDate } from "@/lib/format";
import {
  SERIES_METRICS,
  indexNearestDaysBefore,
  latestIndex,
  type BodyMeasurement,
  type BodyProfile,
} from "@/lib/body-metrics";
import {
  panelMetrics,
  type BodyAppearance,
  type BodyPanels,
  type BodyRegionKey,
  type BodyShapeStyle,
} from "@/lib/body-visualization";
import type { NutritionProgressPoint } from "@/lib/nutrition-progress";
import { BodyFigurePicker } from "./body-figure-picker";
import { BodyMeasurementChart } from "./body-measurement-chart";
import { BodyMetricSummary } from "./body-metric-summary";
import { BodyProgressCard } from "./body-progress-card";
import { ShareablePanel } from "../shareable-panel";

/**
 * Holds the two indices the whole section is derived from. Reference and
 * current are the only state: every delta, polygon and label is a function of
 * that pair, which is what makes the reference selector feel like it changes
 * the entire section at once.
 *
 * The switches reach past the drawings into the cards below them, because those
 * cards are the same measurements in another form: the key figures are all
 * waist- and hip-derived, and the history lists exactly the metrics the two
 * panels are made of.
 */
export function BodyProgressSection({
  measurements,
  profile,
  appearance,
  shapeStyle,
  panels,
  nutritionPoints,
  checkin,
  locale,
}: {
  measurements: BodyMeasurement[];
  profile: BodyProfile;
  appearance: BodyAppearance;
  /** Which of the two shape drawings this reader has chosen. */
  shapeStyle: BodyShapeStyle;
  /** Which of the two visualisations this reader has switched on. */
  panels: BodyPanels;
  /** Daily target attainment, charted on the same time axis as the measurements. */
  nutritionPoints: NutritionProgressPoint[];
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

  /* The rows and chips each switch is answerable for, in their catalogue and
     reading orders respectively. */
  const metrics = panelMetrics(panels);
  const seriesMetrics = SERIES_METRICS.filter((key) => key === "bmi" || metrics.includes(key));

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
  /* The figure picker only changes how the drawn body looks, so it goes with
     the drawing. The check-in button stays whatever is on screen. */
  const actions = (
    <span className="body-card-actions">
      {panels.shape ? (
        <BodyFigurePicker key="figure" appearance={appearance} shapeStyle={shapeStyle} locale={locale} />
      ) : null}
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
        shapeStyle={shapeStyle}
        hasReference={hasReference}
        figurePicker={actions}
        panels={panels}
        locale={locale}
      />

      {/* Every key figure here is the waist or the hip read against height,
          each other or an estimate built from them, so they belong to the shape
          switch and go with it. */}
      {panels.shape ? (
        <ShareablePanel title={t("summary.microHead")} fileName="nutricore-key-figures">
          <BodyMetricSummary
            current={measurements[currentIndex]}
            reference={measurements[hasReference ? referenceIndex : currentIndex]}
            profile={profile}
            referenceLabel={referenceLabel}
            hasReference={hasReference}
            locale={locale}
          />
        </ShareablePanel>
      ) : null}

      {/* One chart for the whole page: what the body measures and what went
          into it read against each other, or either one on its own. */}
      {(measurements.length > 1 && seriesMetrics.length > 0) || nutritionPoints.length > 0 ? (
        <ShareablePanel title={t("series.title")} fileName="nutricore-measurements-chart">
          <BodyMeasurementChart
            measurements={measurements}
            referenceIndex={referenceIndex}
            currentIndex={currentIndex}
            onCurrentIndex={selectCurrent}
            metrics={measurements.length > 1 ? seriesMetrics : []}
            nutritionPoints={nutritionPoints}
            profile={profile}
            locale={locale}
          />
        </ShareablePanel>
      ) : null}

      {/* The disclaimer is about the drawn figure, so it goes when the figure does. */}
      {panels.shape ? <p className="body-caption">{t("figure.disclaimer")}</p> : null}
    </div>
  );
}
