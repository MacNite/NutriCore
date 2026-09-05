"use client";

import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { emptyMeasurement, type BodyMeasurement } from "@/lib/body-metrics";
import type { BodyAppearance, BodyPanels, BodyRegionKey, BodyShapeStyle } from "@/lib/body-visualization";
import { BodyChangeHeatmap } from "./body-change-heatmap";
import { BodyCompositionDiamond } from "./body-composition-diamond";
import { BodyMeasureFigure } from "./body-measure-figure";
import { BodyReferenceBar } from "./body-reference-bar";
import { BodyShapeProgress, useBodyShapeSummary } from "./body-shape-progress";
import { ShareablePanel } from "../shareable-panel";

/**
 * The hero: composition on the left, shape on the right, both read against the
 * reference chosen at the top of the card. Roughly a 45/55 split on desktop,
 * stacked below 900px.
 *
 * Either panel can be switched off in settings; a single remaining panel gets
 * the full card rather than staying in its half. With both off the whole
 * section is gone before this renders, so there is no empty-card state here.
 */
export function BodyProgressCard({
  measurements,
  referenceIndex,
  currentIndex,
  comparable,
  onReferenceIndex,
  activeRegion,
  onActiveRegion,
  referenceLabel,
  appearance,
  shapeStyle,
  hasReference,
  figurePicker,
  panels,
  locale,
}: {
  measurements: BodyMeasurement[];
  referenceIndex: number;
  currentIndex: number;
  /** The sessions worth comparing against, as indices into `measurements`. */
  comparable: readonly number[];
  onReferenceIndex: (index: number) => void;
  activeRegion: BodyRegionKey | null;
  onActiveRegion: (region: BodyRegionKey | null) => void;
  referenceLabel: string;
  appearance: BodyAppearance;
  shapeStyle: BodyShapeStyle;
  hasReference: boolean;
  figurePicker: React.ReactNode;
  panels: BodyPanels;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const current = measurements[currentIndex];
  const reference = hasReference ? measurements[referenceIndex] : emptyMeasurement(current.date);
  const shapeSummary = useBodyShapeSummary(current, reference, referenceLabel, locale);
  const shown = Number(panels.composition) + Number(panels.shape);

  return (
    <section className="card" aria-labelledby="body-hero-heading">
      <div className="card-head body-card-head">
        <h2 id="body-hero-heading">{t("title")}</h2>
        {figurePicker}
      </div>

      {hasReference ? (
        <BodyReferenceBar
          measurements={measurements}
          referenceIndex={referenceIndex}
          currentIndex={currentIndex}
          comparable={comparable}
          onReferenceIndex={onReferenceIndex}
          locale={locale}
        />
      ) : (
        <p className="notice" role="note" style={{ marginBottom: 18 }}>
          <span className="notice-icon" aria-hidden="true">
            i
          </span>
          <span>{t("empty.needsSecond")}</span>
        </p>
      )}

      <div className={shown === 1 ? "body-hero body-hero-single" : "body-hero"}>
        {panels.composition ? (
          <ShareablePanel className="body-hero-panel" title={t("composition.title")} fileName="nutricore-body-composition">
            <BodyCompositionDiamond
              current={current}
              reference={reference}
              referenceLabel={referenceLabel}
              hasReference={hasReference}
              locale={locale}
            />
          </ShareablePanel>
        ) : null}

        {panels.shape ? (
          <ShareablePanel className="body-hero-panel" title={t("shape.title")} fileName="nutricore-body-shape">
            <p className="body-micro-head">{t("shape.microHead")}</p>
            {/* The figure is decorative once this sentence exists; the sentence is
                the guaranteed equivalent for anyone not reading the drawing. */}
            <p className="sr-only">{shapeSummary}</p>
            {/* Two drawings of the same numbers; the reader picks which one. */}
            {shapeStyle === "MEASURE" ? (
              <BodyMeasureFigure
                current={current}
                reference={reference}
                appearance={appearance}
                hasReference={hasReference}
                locale={locale}
                referenceLabel={referenceLabel}
                active={activeRegion}
                onActive={onActiveRegion}
              />
            ) : (
              <BodyShapeProgress
                current={current}
                reference={reference}
                appearance={appearance}
                hasReference={hasReference}
                locale={locale}
                referenceLabel={referenceLabel}
                active={activeRegion}
                onActive={onActiveRegion}
              />
            )}
            <BodyChangeHeatmap
              current={current}
              reference={reference}
              locale={locale}
              referenceLabel={referenceLabel}
              active={activeRegion}
              onActive={onActiveRegion}
            />
          </ShareablePanel>
        ) : null}
      </div>
    </section>
  );
}
