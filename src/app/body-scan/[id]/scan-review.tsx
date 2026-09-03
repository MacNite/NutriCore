"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { applyBodyScanAction } from "@/server/body-scan-actions";
import type { FormState } from "@/server/profile-actions";
import type { ScanReviewEstimate } from "@/server/body-scan";

/**
 * The screen that turns estimates into measurements, or does not.
 *
 * Nothing is ticked when this loads. An accept-all default would make the
 * review a formality, and the review is the entire safeguard: everything on
 * this page is a model's opinion about a photograph until a person says
 * otherwise. The existing value sits beside each estimate because that is the
 * comparison the decision actually rests on.
 */
export function ScanReview({
  scanId,
  estimates,
  locale,
}: {
  scanId: string;
  estimates: ScanReviewEstimate[];
  locale: string;
}) {
  const t = useTranslations("bodyScan");
  const body = useTranslations("bodyProgress");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const id = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(applyBodyScanAction, {});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const anyAccepted = Object.values(accepted).some(Boolean);

  if (state.ok) {
    return (
      <div className="notice" role="status">
        <span className="notice-icon" aria-hidden="true">
          ✓
        </span>
        <span>{anyAccepted ? t("review.saved") : t("review.discarded")}</span>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="scanId" value={scanId} />

      {state.error ? (
        <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <span>{state.error === "already-reviewed" ? t("review.alreadyReviewed") : errors("validation")}</span>
        </div>
      ) : null}

      <table className="table">
        <caption className="sr-only">{t("review.tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("review.accept")}</th>
            <th scope="col">{t("review.region")}</th>
            <th scope="col">{t("review.estimate")}</th>
            <th scope="col">{t("review.range")}</th>
            <th scope="col">{t("review.current")}</th>
          </tr>
        </thead>
        <tbody>
          {estimates.map((estimate) => {
            const checked = accepted[estimate.metricKey] ?? false;
            return (
              <tr key={estimate.metricKey}>
                <td>
                  <input
                    id={`${id}-${estimate.metricKey}`}
                    type="checkbox"
                    name={`accept:${estimate.metricKey}`}
                    checked={checked}
                    onChange={(event) =>
                      setAccepted((current) => ({ ...current, [estimate.metricKey]: event.target.checked }))
                    }
                  />
                </td>
                <th scope="row">
                  <label htmlFor={`${id}-${estimate.metricKey}`}>{body(`metric.${estimate.metricKey}`)}</label>
                </th>
                <td>
                  {/* Editable, because a user who knows the estimate is wrong
                      should correct it here rather than accept a number they
                      disbelieve and fix it on another screen. An edited value
                      is recorded as their own measurement, not as the scan's. */}
                  <input
                    type="number"
                    name={`value:${estimate.metricKey}`}
                    min="5"
                    max="250"
                    step="0.1"
                    defaultValue={estimate.valueCm}
                    disabled={!checked}
                    aria-label={`${body(`metric.${estimate.metricKey}`)} (${body("unit.cm")})`}
                  />
                </td>
                <td className="muted">
                  {t("review.rangeValue", {
                    lower: number.format(estimate.lowerCm),
                    upper: number.format(estimate.upperCm),
                  })}
                </td>
                <td className="muted">
                  {estimate.currentCm === null ? common("noData") : number.format(estimate.currentCm)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="muted">{anyAccepted ? t("review.willWrite") : t("review.willDiscard")}</p>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? common("loading") : anyAccepted ? t("review.submit") : t("review.submitEmpty")}
      </button>
    </form>
  );
}
