"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { emptyMeasurement, type BodyMeasurement } from "@/lib/body-metrics";
import type { BodyAppearance, BodyPanels, BodyRegionKey } from "@/lib/body-visualization";
import { BodyChangeHeatmap } from "./body-change-heatmap";
import { BodyCompositionDiamond } from "./body-composition-diamond";
import { BodyReferenceBar } from "./body-reference-bar";
import { BodyShapeProgress, useBodyShapeSummary } from "./body-shape-progress";

/**
 * The hero: composition on the left, shape on the right, both read against the
 * reference chosen at the top of the card. Roughly a 45/55 split on desktop,
 * stacked below 900px.
 *
 * Either panel can be switched off in settings. A single remaining panel gets
 * the full width rather than staying in its half, and with both off the card
 * keeps its head and reference bar - the reference drives the summary, chart
 * and table below it, so the section still needs to be steerable from here.
 */
export function BodyProgressCard({
  measurements,
  referenceIndex,
  currentIndex,
  onReferenceIndex,
  activeRegion,
  onActiveRegion,
  referenceLabel,
  appearance,
  hasReference,
  figurePicker,
  panels,
  locale,
}: {
  measurements: BodyMeasurement[];
  referenceIndex: number;
  currentIndex: number;
  onReferenceIndex: (index: number) => void;
  activeRegion: BodyRegionKey | null;
  onActiveRegion: (region: BodyRegionKey | null) => void;
  referenceLabel: string;
  appearance: BodyAppearance;
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

      {shown === 0 ? (
        <p className="notice" role="note">
          <span className="notice-icon" aria-hidden="true">
            i
          </span>
          <span>
            {t("panels.allHidden")} <Link href="/settings">{t("panels.settingsLink")}</Link>
          </span>
        </p>
      ) : (
        <div className={shown === 1 ? "body-hero body-hero-single" : "body-hero"}>
          {panels.composition ? (
            <div className="body-hero-panel">
              <BodyCompositionDiamond
                current={current}
                reference={reference}
                referenceLabel={referenceLabel}
                hasReference={hasReference}
                locale={locale}
              />
            </div>
          ) : null}

          {panels.shape ? (
            <div className="body-hero-panel">
              <p className="body-micro-head">{t("shape.microHead")}</p>
              {/* The figure is decorative once this sentence exists; the sentence is
                  the guaranteed equivalent for anyone not reading the drawing. */}
              <p className="sr-only">{shapeSummary}</p>
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
              <BodyChangeHeatmap
                current={current}
                reference={reference}
                locale={locale}
                referenceLabel={referenceLabel}
                active={activeRegion}
                onActive={onActiveRegion}
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
