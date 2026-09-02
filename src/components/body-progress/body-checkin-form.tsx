"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AppDialog } from "@/components/app-dialog";

const CIRCUMFERENCES = ["neckCm", "chestCm", "waistCm", "hipCm"] as const;
const PAIRED = ["upperArmCm", "thighCm", "calfCm"] as const;
const COMPOSITION = [
  { key: "bodyFatPct", unit: "percent", step: "0.1", max: "80" },
  { key: "muscleKg", unit: "kg", step: "0.1", max: "120" },
  { key: "bodyWaterPct", unit: "percent", step: "0.1", max: "90" },
  { key: "boneKg", unit: "kg", step: "0.1", max: "20" },
] as const;

/**
 * Manual measurement entry. The four numbers people actually record every week
 * are visible immediately; paired limbs and composition sit behind one
 * disclosure so a weekly session stays short.
 *
 * Design preview: submitting confirms and resets, it does not persist.
 */
export function BodyCheckinForm({ today }: { today: string }) {
  const t = useTranslations("bodyProgress");
  const common = useTranslations("common");
  const [saved, setSaved] = useState(false);
  const id = useId();

  return (
    <AppDialog
      id={`${id}-checkin`}
      title={t("checkin.title")}
      closeLabel={common("close")}
      triggerClassName="btn btn-primary"
      trigger={
        <>
          <span aria-hidden="true">+</span>
          {t("checkin.open")}
        </>
      }
    >
      <p className="dialog-hint muted">{t("checkin.intro")}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(true);
        }}
      >
        {saved ? (
          <div className="notice notice-warn" role="status" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">
              !
            </span>
            <span>{t("checkin.previewOnly")}</span>
          </div>
        ) : null}

        <fieldset className="body-checkin-section">
          <legend>{t("checkin.basics")}</legend>
          <div className="body-checkin-grid">
            <div className="field">
              <label htmlFor={`${id}-date`}>{t("checkin.date")}</label>
              <input id={`${id}-date`} name="date" type="date" defaultValue={today} required />
            </div>
            <div className="field">
              <label htmlFor={`${id}-weight`}>{`${t("metric.weightKg")} (${t("unit.kg")})`}</label>
              <input id={`${id}-weight`} name="weightKg" type="number" min="20" max="400" step="0.1" />
            </div>
          </div>
        </fieldset>

        <fieldset className="body-checkin-section">
          <legend>{t("checkin.circumferences")}</legend>
          <div className="body-checkin-grid">
            {CIRCUMFERENCES.map((key) => (
              <div className="field" key={key}>
                <label htmlFor={`${id}-${key}`}>{`${t(`metric.${key}`)} (${t("unit.cm")})`}</label>
                <input id={`${id}-${key}`} name={key} type="number" min="10" max="250" step="0.1" />
              </div>
            ))}
          </div>
        </fieldset>

        <details className="body-advanced">
          <summary>{t("checkin.advanced")}</summary>

          <fieldset className="body-checkin-section">
            <legend>{t("checkin.limbs")}</legend>
            <div className="body-checkin-grid">
              {PAIRED.flatMap((key) =>
                (["left", "right"] as const).map((side) => (
                  <div className="field" key={`${key}-${side}`}>
                    <label htmlFor={`${id}-${key}-${side}`}>
                      {`${t(`metric.${key}`)} ${t(`checkin.${side}`)} (${t("unit.cm")})`}
                    </label>
                    <input
                      id={`${id}-${key}-${side}`}
                      name={`${key}.${side}`}
                      type="number"
                      min="10"
                      max="150"
                      step="0.1"
                    />
                  </div>
                )),
              )}
            </div>
          </fieldset>

          <fieldset className="body-checkin-section">
            <legend>{t("checkin.composition")}</legend>
            <div className="body-checkin-grid">
              {COMPOSITION.map((entry) => (
                <div className="field" key={entry.key}>
                  <label htmlFor={`${id}-${entry.key}`}>
                    {`${t(`metric.${entry.key}`)} (${t(`unit.${entry.unit}`)})`}
                  </label>
                  <input
                    id={`${id}-${entry.key}`}
                    name={entry.key}
                    type="number"
                    min="0"
                    max={entry.max}
                    step={entry.step}
                  />
                </div>
              ))}
            </div>
            <div className="field">
              <label htmlFor={`${id}-source`}>{t("checkin.compositionSource")}</label>
              <select id={`${id}-source`} name="compositionSource" defaultValue="BIA">
                <option value="MANUAL">{t("checkin.sourceManual")}</option>
                <option value="BIA">{t("checkin.sourceBia")}</option>
                <option value="OTHER">{t("checkin.sourceOther")}</option>
              </select>
            </div>
          </fieldset>
        </details>

        <button type="submit" className="btn btn-primary btn-block">
          {t("checkin.save")}
        </button>
      </form>
    </AppDialog>
  );
}
