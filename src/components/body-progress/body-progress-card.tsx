"use client";

import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import type { BodyMeasurement } from "@/lib/body-metrics";
import type { BodyRegionKey } from "@/lib/body-visualization";
import { BodyChangeHeatmap } from "./body-change-heatmap";
import { BodyCompositionDiamond } from "./body-composition-diamond";
import { BodyReferenceBar } from "./body-reference-bar";
import { BodyShapeProgress, useBodyShapeSummary } from "./body-shape-progress";

/**
 * The hero: composition on the left, shape on the right, both read against the
 * reference chosen at the top of the card. Roughly a 45/55 split on desktop,
 * stacked below 900px.
 */
export function BodyProgressCard({
  measurements,
  referenceIndex,
  currentIndex,
  onReferenceIndex,
  activeRegion,
  onActiveRegion,
  referenceLabel,
  locale,
}: {
  measurements: BodyMeasurement[];
  referenceIndex: number;
  currentIndex: number;
  onReferenceIndex: (index: number) => void;
  activeRegion: BodyRegionKey | null;
  onActiveRegion: (region: BodyRegionKey | null) => void;
  referenceLabel: string;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const current = measurements[currentIndex];
  const reference = measurements[referenceIndex];
  const shapeSummary = useBodyShapeSummary(current, reference, referenceLabel, locale);

  return (
    <section className="card" aria-labelledby="body-hero-heading">
      <div className="card-head">
        <h2 id="body-hero-heading">{t("title")}</h2>
      </div>

      <BodyReferenceBar
        measurements={measurements}
        referenceIndex={referenceIndex}
        currentIndex={currentIndex}
        onReferenceIndex={onReferenceIndex}
        locale={locale}
      />

      <div className="body-hero">
        <div className="body-hero-panel">
          <BodyCompositionDiamond
            current={current}
            reference={reference}
            referenceLabel={referenceLabel}
            locale={locale}
          />
        </div>

        <div className="body-hero-panel">
          <p className="body-micro-head">{t("shape.microHead")}</p>
          {/* The figure is decorative once this sentence exists; the sentence is
              the guaranteed equivalent for anyone not reading the drawing. */}
          <p className="sr-only">{shapeSummary}</p>
          <BodyShapeProgress
            current={current}
            reference={reference}
            locale={locale}
            referenceLabel={referenceLabel}
            active={activeRegion}
            onActive={onActiveRegion}
          />
          <BodyChangeHeatmap
            current={current}
            reference={reference}
            locale={locale}
            referenceLabel={referenceLabel}
            active={activeRegion}
            onActive={onActiveRegion}
          />
        </div>
      </div>
    </section>
  );
}
