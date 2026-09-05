"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AppDialog } from "@/components/app-dialog";
import type { Locale } from "@/i18n/locales";
import { saveBodyAppearanceAction } from "@/server/body-actions";
import type { FormState } from "@/server/profile-actions";
import {
  BODY_FIGURES,
  BODY_SHAPE_STYLES,
  BODY_TYPES,
  baselineInput,
  type BodyAppearance,
  type BodyFigure,
  type BodyShapeStyle,
  type BodyType,
} from "@/lib/body-visualization";
import { BodyFigureDrawing } from "./body-figure-drawing";

/**
 * Choosing how the figure looks. The somatotype is a look, not a finding: it is
 * never inferred from anyone's measurements and never enters a calculation,
 * which the dialog says in as many words.
 */
export function BodyFigurePicker({
  appearance,
  shapeStyle,
  locale,
}: {
  appearance: BodyAppearance;
  shapeStyle: BodyShapeStyle;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const common = useTranslations("common");
  const id = useId();
  const [figure, setFigure] = useState<BodyFigure>(appearance.figure);
  const [type, setType] = useState<BodyType>(appearance.type);
  const [style, setStyle] = useState<BodyShapeStyle>(shapeStyle);
  const [state, action, pending] = useActionState<FormState, FormData>(saveBodyAppearanceAction, {});

  return (
    <AppDialog
      id={`${id}-figure`}
      title={t("figure.title")}
      closeLabel={common("close")}
      triggerClassName="icon-btn"
      triggerLabel={t("figure.change")}
      trigger={
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      }
    >
      <p className="dialog-hint muted">{t("figure.intro")}</p>

      <form action={action}>
        {state.ok ? (
          <div className="notice" role="status" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">
              ✓
            </span>
            <span>{t("figure.saved")}</span>
          </div>
        ) : null}

        <fieldset className="body-checkin-section">
          <legend>{t("figure.style")}</legend>
          <div className="progress-filters">
            {BODY_SHAPE_STYLES.map((value) => (
              <button
                key={value}
                type="button"
                className="progress-chip"
                aria-pressed={style === value}
                onClick={() => setStyle(value)}
              >
                {t(`figure.styleName.${value}`)}
              </button>
            ))}
          </div>
          <p className="body-caption" style={{ marginTop: 8 }}>
            {t(`figure.styleHint.${style}`)}
          </p>
        </fieldset>

        <fieldset className="body-checkin-section">
          <legend>{t("figure.presentation")}</legend>
          <div className="progress-filters">
            {BODY_FIGURES.map((value) => (
              <button
                key={value}
                type="button"
                className="progress-chip"
                aria-pressed={figure === value}
                onClick={() => setFigure(value)}
              >
                {t(`figure.presentationName.${value}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="body-checkin-section">
          <legend>{t("figure.build")}</legend>
          <div className="body-figure-grid" role="radiogroup" aria-label={t("figure.build")}>
            {BODY_TYPES.map((value) => {
              const option = { type: value, figure };
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  className="body-figure-option"
                  onClick={() => setType(value)}
                >
                  <BodyFigureDrawing
                    input={baselineInput(option)}
                    appearance={option}
                    style={style}
                    label={t(`figure.typeName.${value}`)}
                  />
                  <span>{t(`figure.typeName.${value}`)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <input type="hidden" name="bodyFigure" value={figure} />
        <input type="hidden" name="bodyType" value={type} />
        <input type="hidden" name="bodyShapeStyle" value={style} />

        <p className="body-caption" lang={locale}>
          {t("figure.disclaimer")}
        </p>

        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? common("loading") : common("save")}
        </button>
      </form>
    </AppDialog>
  );
}
