"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AppDialog } from "@/components/app-dialog";
import { saveBodyCheckinAction } from "@/server/body-actions";
import type { FormState } from "@/server/profile-actions";
import type { BodyMeasurement } from "@/lib/body-metrics";

const CIRCUMFERENCES = ["neckCm", "chestCm", "waistCm", "hipCm"] as const;
const PAIRED = [
  ["upperArmCm", "upperArmLeftCm", "upperArmRightCm"],
  ["thighCm", "thighLeftCm", "thighRightCm"],
  ["calfCm", "calfLeftCm", "calfRightCm"],
] as const;
const COMPOSITION = [
  { key: "bodyFatPct", unit: "percent", max: "80" },
  { key: "muscleKg", unit: "kg", max: "150" },
  { key: "bodyWaterPct", unit: "percent", max: "90" },
  { key: "boneKg", unit: "kg", max: "20" },
] as const;

/**
 * Manual measurement entry. The five numbers people actually record every week
 * are visible immediately; paired limbs and composition sit behind one
 * disclosure so a weekly session stays short.
 *
 * Picking a date that already has a session loads it, so the form doubles as
 * the way to correct a typo. Weight is saved to the weight log, not here.
 */
export function BodyCheckinForm({
  today,
  measurements,
}: {
  today: string;
  measurements: BodyMeasurement[];
}) {
  const t = useTranslations("bodyProgress");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const id = useId();
  const [date, setDate] = useState(today);
  const [state, action, pending] = useActionState<FormState, FormData>(saveBodyCheckinAction, {});

  const existing = measurements.find((measurement) => measurement.date === date);
  const value = (key: keyof BodyMeasurement) => {
    const current = existing?.[key];
    return typeof current === "number" ? String(current) : "";
  };

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

      <form action={action}>
        {state.ok ? (
          <div className="notice" role="status" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">
              ✓
            </span>
            <span>{t("checkin.saved")}</span>
          </div>
        ) : state.error ? (
          <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">
              !
            </span>
            <span>{state.error === "empty" ? t("checkin.nothingEntered") : errors("validation")}</span>
          </div>
        ) : null}

        <fieldset className="body-checkin-section">
          <legend>{t("checkin.basics")}</legend>
          <div className="body-checkin-grid">
            <div className="field">
              <label htmlFor={`${id}-date`}>{t("checkin.date")}</label>
              <input
                id={`${id}-date`}
                name="date"
                type="date"
                max={today}
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${id}-weight`}>{`${t("metric.weightKg")} (${t("unit.kg")})`}</label>
              <input
                key={`weight-${date}`}
                id={`${id}-weight`}
                name="weightKg"
                type="number"
                min="20"
                max="400"
                step="0.1"
                defaultValue={value("weightKg")}
              />
              <span className="hint">{t("checkin.weightHint")}</span>
            </div>
          </div>
        </fieldset>

        <fieldset className="body-checkin-section">
          <legend>{t("checkin.circumferences")}</legend>
          <div className="body-checkin-grid">
            {CIRCUMFERENCES.map((key) => (
              <div className="field" key={key}>
                <label htmlFor={`${id}-${key}`}>{`${t(`metric.${key}`)} (${t("unit.cm")})`}</label>
                <input
                  key={`${key}-${date}`}
                  id={`${id}-${key}`}
                  name={key}
                  type="number"
                  min="15"
                  max="250"
                  step="0.1"
                  defaultValue={value(key)}
                />
              </div>
            ))}
          </div>
        </fieldset>

        <details className="body-advanced">
          <summary>{t("checkin.advanced")}</summary>

          <fieldset className="body-checkin-section">
            <legend>{t("checkin.limbs")}</legend>
            <div className="body-checkin-grid">
              {PAIRED.flatMap(([label, left, right]) =>
                ([
                  ["left", left],
                  ["right", right],
                ] as const).map(([side, field]) => (
                  <div className="field" key={field}>
                    <label htmlFor={`${id}-${field}`}>
                      {`${t(`metric.${label}`)} ${t(`checkin.${side}`)} (${t("unit.cm")})`}
                    </label>
                    <input
                      key={`${field}-${date}`}
                      id={`${id}-${field}`}
                      name={field}
                      type="number"
                      min="10"
                      max="150"
                      step="0.1"
                      defaultValue={value(field)}
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
                    key={`${entry.key}-${date}`}
                    id={`${id}-${entry.key}`}
                    name={entry.key}
                    type="number"
                    min="0"
                    max={entry.max}
                    step="0.1"
                    defaultValue={value(entry.key)}
                  />
                </div>
              ))}
            </div>
            <div className="field">
              <label htmlFor={`${id}-source`}>{t("checkin.compositionSource")}</label>
              <select
                key={`source-${date}`}
                id={`${id}-source`}
                name="compositionSource"
                defaultValue={existing?.compositionSource ?? "BIA"}
              >
                <option value="MANUAL">{t("checkin.sourceManual")}</option>
                <option value="BIA">{t("checkin.sourceBia")}</option>
                <option value="OTHER_DEVICE">{t("checkin.sourceOther")}</option>
              </select>
            </div>
          </fieldset>
        </details>

        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? common("loading") : t("checkin.save")}
        </button>
      </form>
    </AppDialog>
  );
}
