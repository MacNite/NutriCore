"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AppDialog } from "@/components/app-dialog";
import { startBodyScanAction } from "@/server/body-scan-actions";
import type { FormState } from "@/server/profile-actions";

/**
 * Capture for a two-view body scan.
 *
 * `capture="environment"` asks a phone for its camera and falls back to the
 * file picker everywhere else - which is not only a nicety. Live camera capture
 * needs a secure context, and NutriCore deliberately supports plain-HTTP LAN
 * deployments, so on those the picker is the only thing that can work. Nothing
 * here depends on which one the browser chose.
 *
 * The instructions are not decoration. This estimator reads a silhouette
 * against a plain background, and a capture that ignores them fails a quality
 * check rather than producing a quietly wrong number - so the conditions are
 * stated before the file inputs rather than hidden in a help page.
 */
export function BodyScanForm({ today, heightCm }: { today: string; heightCm: number | null }) {
  const t = useTranslations("bodyScan");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const id = useId();
  const [consented, setConsented] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(startBodyScanAction, {});

  const message = (() => {
    switch (state.error) {
      case undefined:
        return null;
      case "height-required":
        return t("errors.heightRequired");
      case "both-views-required":
        return t("errors.bothViewsRequired");
      case "consent-required":
        return t("errors.consentRequired");
      case "imageTooLarge":
        return t("errors.imageTooLarge");
      case "imageInvalid":
      case "imageEmpty":
        return t("errors.imageInvalid");
      case "rateLimited":
        return errors("rateLimited");
      default:
        return errors("validation");
    }
  })();

  return (
    <AppDialog
      id={`${id}-scan`}
      title={t("capture.title")}
      closeLabel={common("close")}
      triggerClassName="btn"
      trigger={<>{t("capture.open")}</>}
    >
      <p className="dialog-hint muted">{t("capture.intro")}</p>

      {/* Said before anything is captured, not after. An estimate presented as
          a measurement is the one failure mode this feature must not have. */}
      <div className="notice" role="note" style={{ marginBottom: 14 }}>
        <span className="notice-icon" aria-hidden="true">
          i
        </span>
        <span>{t("capture.notAMeasurement")}</span>
      </div>

      <form action={action}>
        {message ? (
          <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
            <span className="notice-icon" aria-hidden="true">
              !
            </span>
            <span>{message}</span>
          </div>
        ) : null}

        {heightCm === null ? (
          <p className="empty">{t("errors.heightRequired")}</p>
        ) : (
          <>
            <fieldset className="body-checkin-section">
              <legend>{t("capture.conditions")}</legend>
              <ul className="muted" style={{ margin: "0 0 4px", paddingLeft: 18 }}>
                <li>{t("capture.tips.background")}</li>
                <li>{t("capture.tips.clothing")}</li>
                <li>{t("capture.tips.framing")}</li>
                <li>{t("capture.tips.pose")}</li>
                <li>{t("capture.tips.repeat")}</li>
              </ul>
            </fieldset>

            <fieldset className="body-checkin-section">
              <legend>{t("capture.views")}</legend>
              <div className="body-checkin-grid">
                <div className="field">
                  <label htmlFor={`${id}-date`}>{t("capture.date")}</label>
                  <input id={`${id}-date`} name="date" type="date" max={today} defaultValue={today} required />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-height`}>{t("capture.height")}</label>
                  <input id={`${id}-height`} type="text" value={`${heightCm} cm`} readOnly disabled />
                  <span className="hint">{t("capture.heightHint")}</span>
                </div>
                <div className="field">
                  <label htmlFor={`${id}-front`}>{t("capture.front")}</label>
                  <input
                    id={`${id}-front`}
                    name="front"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-side`}>{t("capture.side")}</label>
                  <input
                    id={`${id}-side`}
                    name="side"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    required
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="body-checkin-section">
              <legend>{t("capture.consentLegend")}</legend>
              <div className="field">
                <label htmlFor={`${id}-consent`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input
                    id={`${id}-consent`}
                    name="consent"
                    type="checkbox"
                    checked={consented}
                    onChange={(event) => setConsented(event.target.checked)}
                    required
                  />
                  <span>{t("capture.consent")}</span>
                </label>
                <span className="hint">{t("capture.retention")}</span>
              </div>
            </fieldset>

            <button type="submit" className="btn btn-primary btn-block" disabled={pending || !consented}>
              {pending ? common("loading") : t("capture.submit")}
            </button>
          </>
        )}
      </form>
    </AppDialog>
  );
}
