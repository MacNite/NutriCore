"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import {
  BODY_METRIC_BY_KEY,
  formatMeasure,
  metricDelta,
  metricSource,
  metricValue,
  type BodyMeasurement,
  type BodyMetricKey,
} from "@/lib/body-metrics";
import { BodyFold } from "./body-fold";
import { BodySourceBadge, DeltaText, UNIT_KEY } from "./body-value";

/**
 * The tabular form of everything the two visualisations show, so it lists
 * exactly the metrics they do: switching a panel off takes its rows with it. On
 * narrow screens each row folds into a compact card via CSS, so the table never
 * scrolls sideways on a phone.
 *
 * It is the exact numbers behind the charts above rather than a reading of its
 * own, so it stays collapsed at every width until someone asks for it.
 */
export function BodyMeasurementTable({
  current,
  reference,
  referenceLabel,
  hasReference,
  metrics,
  locale,
}: {
  current: BodyMeasurement;
  reference: BodyMeasurement;
  referenceLabel: string;
  hasReference: boolean;
  /** The rows to list, already narrowed to the switched-on panels. */
  metrics: BodyMetricKey[];
  locale: Locale;
}) {
  const t = useTranslations("bodyProgress");
  const [open, setOpen] = useState(false);

  return (
    <section className="card" aria-labelledby="body-table-heading">
      <h2 id="body-table-heading">{t("table.title")}</h2>
      <p className="muted nutrition-subtitle">
        {hasReference ? t("table.subtitle", { date: referenceLabel }) : t("summary.firstSession")}
      </p>

      <BodyFold
        label={t("table.foldLabel", { count: metrics.length })}
        open={open}
        onToggle={() => setOpen(!open)}
        always
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
          {metrics.map((key) => {
            const def = BODY_METRIC_BY_KEY.get(key)!;
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
