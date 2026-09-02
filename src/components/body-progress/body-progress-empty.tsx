"use client";

import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { baselineInput, type BodyAppearance, type BodyPanels } from "@/lib/body-visualization";
import { BodyFigureDrawing } from "./body-figure-drawing";
import { BodyFigurePicker } from "./body-figure-picker";

/**
 * Before the first check-in there is nothing to compare, so the card shows what
 * the figure will look like and what a session records, rather than an empty
 * chart frame.
 *
 * With the shape visualisation switched off there is no figure to preview, so
 * the card is text and the check-in button - promising a drawing the reader has
 * turned off would be the wrong invitation.
 */
export function BodyProgressEmpty({
  appearance,
  panels,
  checkin,
  locale,
}: {
  appearance: BodyAppearance;
  panels: BodyPanels;
  checkin: React.ReactNode;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");

  return (
    <section className="card" aria-labelledby="body-empty-heading">
      <div className="card-head body-card-head">
        <h2 id="body-empty-heading">{t("title")}</h2>
        {panels.shape ? <BodyFigurePicker appearance={appearance} locale={locale} /> : null}
      </div>

      <div className={panels.shape ? "body-empty" : "body-empty body-empty-single"}>
        {panels.shape ? (
          <div className="body-empty-figure">
            <BodyFigureDrawing
              input={baselineInput(appearance)}
              appearance={appearance}
              label={t(`figure.typeName.${appearance.type}`)}
            />
          </div>
        ) : null}

        <div>
          <p style={{ marginTop: 0 }}>{t("empty.intro")}</p>
          <p className="muted">{t("empty.records")}</p>
          {checkin}
          {panels.shape ? <p className="body-caption">{t("figure.disclaimer")}</p> : null}
        </div>
      </div>
    </section>
  );
}
