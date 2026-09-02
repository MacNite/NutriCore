"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import {
  BODY_METRICS,
  formatMeasure,
  metricDelta,
  metricSource,
  metricValue,
  type BodyMeasurement,
} from "@/lib/body-metrics";
import { BodyFold } from "./body-fold";
import { BodySourceBadge, DeltaText, UNIT_KEY } from "./body-value";

/**
 * The tabular form of everything the two visualisations show. On narrow screens
 * each row folds into a compact card via CSS, so the table never scrolls
 * sideways on a phone.
 */
export function BodyMeasurementTable({
  current,
  reference,
  referenceLabel,
  locale,
}: {
  current: BodyMeasurement;
  reference: BodyMeasurement;
  referenceLabel: string;
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const [open, setOpen] = useState(false);

  return (
    <section className="card" aria-labelledby="body-table-heading">
      <h2 id="body-table-heading">{t("table.title")}</h2>
      <p className="muted nutrition-subtitle">{t("table.subtitle", { date: referenceLabel })}</p>

      <BodyFold
        label={t("table.foldLabel", { count: BODY_METRICS.length })}
        open={open}
        onToggle={() => setOpen(!open)}
      >
        <table className="table body-detail-table">
        <thead>
          <tr>
            <th scope="col">{t("table.measurement")}</th>
            <th scope="col" className="num">
              {t("table.current")}
            </th>
            <th scope="col" className="num">
              {t("table.deltaReference")}
            </th>
            <th scope="col">{t("table.source")}</th>
          </tr>
        </thead>
        <tbody>
          {BODY_METRICS.map((def) => {
            const value = metricValue(current, def.key);
            return (
              <tr key={def.key}>
                <th scope="row" data-col="name">
                  {t(`metric.${def.key}`)}
                </th>
                <td className="num" data-col="value">
                  {value == null ? "–" : `${formatMeasure(value, locale, def.digits)} ${t(UNIT_KEY[def.unit])}`}
                </td>
                <td className="num" data-col="delta">
                  <DeltaText
                    delta={metricDelta(current, reference, def.key)}
                    unit={t(UNIT_KEY[def.deltaUnit])}
                    locale={locale}
                    digits={def.digits}
                  />
                </td>
                <td data-col="source">
                  <BodySourceBadge source={metricSource(current, def.key)} />
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </BodyFold>
    </section>
  );
}
