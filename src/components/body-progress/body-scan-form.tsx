"use client";

import { useActionState, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AppDialog } from "@/components/app-dialog";
import { startBodyScanAction } from "@/server/body-scan-actions";
import type { FormState } from "@/server/profile-actions";

/**
 * One view of the scan: a single file input, reached through two named buttons.
 *
 * A file input carrying `capture` sends a phone straight to the camera, with no
 * way back to the photos already on the device - so a single control cannot
 * offer both. The input therefore carries no `capture` in the markup, and the
 * attribute is set or removed on the click that opens it. Which button was
 * pressed is the only thing that decides, and the file that arrives is the same
 * either way.
 *
 * `capture` is honoured on phones and ignored elsewhere, where both buttons
 * open the ordinary picker. That is also the fallback on the plain-HTTP LAN
 * deployments NutriCore supports: live camera capture needs a secure context,
 * and there the picker is the only thing that can work.
 */
function ScanImageField({
  id,
  name,
  label,
  onSelect,
}: {
  id: string;
  name: string;
  label: string;
  onSelect: (selected: boolean) => void;
}) {
  const t = useTranslations("bodyScan");
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const open = (fromCamera: boolean) => {
    const input = inputRef.current;
    if (!input) return;
    if (fromCamera) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };

  return (
    <div className="field">
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <div className="scan-source">
        <button type="button" className="btn" onClick={() => open(true)} aria-label={t("capture.cameraFor", { view: label })}>
          <span aria-hidden="true">◉</span> {t("capture.camera")}
        </button>
        <button type="button" className="btn" onClick={() => open(false)} aria-label={t("capture.fileFor", { view: label })}>
          <span aria-hidden="true">▤</span> {t("capture.file")}
        </button>
      </div>
      {/* Hidden, not absent: it still carries the field name, so the form posts
          exactly what it posted before the buttons existed. */}
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-labelledby={`${id}-label`}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          setFileName(file?.name ?? null);
          onSelect(file !== null);
        }}
      />
      <span className="hint scan-source-file" aria-live="polite">
        {fileName ?? t("capture.noFile")}
      </span>
    </div>
  );
}

/**
 * Capture for a two-view body scan.
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
  /* The inputs are hidden, so `required` on them would block submission with a
     validation bubble nobody can see. The button carries that job instead, and
     the action still refuses a scan that reaches it with a view missing. */
  const [views, setViews] = useState({ front: false, side: false });
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
              <div className="body-checkin-grid" style={{ marginBottom: 12 }}>
                <div className="field">
                  <label htmlFor={`${id}-date`}>{t("capture.date")}</label>
                  <input id={`${id}-date`} name="date" type="date" max={today} defaultValue={today} required />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-height`}>{t("capture.height")}</label>
                  <input id={`${id}-height`} type="text" value={`${heightCm} cm`} readOnly disabled />
                  <span className="hint">{t("capture.heightHint")}</span>
                </div>
              </div>
              <ScanImageField
                id={`${id}-front`}
                name="front"
                label={t("capture.front")}
                onSelect={(selected) => setViews((current) => ({ ...current, front: selected }))}
              />
              <ScanImageField
                id={`${id}-side`}
                name="side"
                label={t("capture.side")}
                onSelect={(selected) => setViews((current) => ({ ...current, side: selected }))}
              />
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

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={pending || !consented || !views.front || !views.side}
            >
              {pending ? common("loading") : t("capture.submit")}
            </button>
          </>
        )}
      </form>
    </AppDialog>
  );
}
