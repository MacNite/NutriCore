"use client";

import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { baselineInput, type BodyAppearance } from "@/lib/body-visualization";
import { BodyFigureDrawing } from "./body-figure-drawing";
import { BodyFigurePicker } from "./body-figure-picker";

/**
 * Before the first check-in there is nothing to compare, so the card shows what
 * the figure will look like and what a session records, rather than an empty
 * chart frame.
 */
export function BodyProgressEmpty({
  appearance,
  checkin,
  locale,
}: {
  appearance: BodyAppearance;
  checkin: React.ReactNode;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");

  return (
    <section className="card" aria-labelledby="body-empty-heading">
      <div className="card-head body-card-head">
        <h2 id="body-empty-heading">{t("title")}</h2>
        <BodyFigurePicker appearance={appearance} locale={locale} />
      </div>

      <div className="body-empty">
        <div className="body-empty-figure">
          <BodyFigureDrawing
            input={baselineInput(appearance)}
            appearance={appearance}
            label={t(`figure.typeName.${appearance.type}`)}
          />
        </div>

        <div>
          <p style={{ marginTop: 0 }}>{t("empty.intro")}</p>
          <p className="muted">{t("empty.records")}</p>
          {checkin}
          <p className="body-caption">{t("figure.disclaimer")}</p>
        </div>
      </div>
    </section>
  );
}
