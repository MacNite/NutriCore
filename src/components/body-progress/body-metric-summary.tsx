"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import {
  deltaBetween,
  formatMeasure,
  metricDelta,
  metricValue,
  relativeFatMass,
  waistToHeight,
  waistToHip,
  type BodyMeasurement,
  type BodyProfile,
  type Delta,
  type MeasurementSource,
} from "@/lib/body-metrics";
import { BodySourceBadge, DeltaText } from "./body-value";

interface Kpi {
  id: string;
  name: string;
  value: number | null;
  unit: string;
  digits: number;
  delta: Delta | null;
  deltaUnit: string;
  source?: MeasurementSource;
  info?: string;
  unavailable?: string;
}

/**
 * Compact figures under the hero. Deliberately secondary: smaller type, no
 * chart, and every derived or estimated number carries its provenance badge.
 */
export function BodyMetricSummary({
  current,
  reference,
  profile,
  locale,
  referenceLabel,
}: {
  current: BodyMeasurement;
  reference: BodyMeasurement;
  profile: BodyProfile;
  locale: Locale;
  referenceLabel: string;
}) {
  const t = useTranslations("bodyProgress");

  const currentWhtr = waistToHeight(current.waistCm, profile.heightCm);
  const currentWhr = waistToHip(current.waistCm, current.hipCm);
  const currentRfm = relativeFatMass(profile, current.waistCm);

  const kpis: Kpi[] = [
    {
      id: "weight",
      name: t("metric.weightKg"),
      value: metricValue(current, "weightKg"),
      unit: t("unit.kg"),
      digits: 1,
      delta: metricDelta(current, reference, "weightKg"),
      deltaUnit: t("unit.kg"),
    },
    {
      id: "waist",
      name: t("metric.waistCm"),
      value: metricValue(current, "waistCm"),
      unit: t("unit.cm"),
      digits: 1,
      delta: metricDelta(current, reference, "waistCm"),
      deltaUnit: t("unit.cm"),
    },
    {
      id: "whtr",
      name: t("kpi.whtr"),
      value: currentWhtr,
      unit: "",
      digits: 3,
      delta: deltaBetween(currentWhtr, waistToHeight(reference.waistCm, profile.heightCm), 3),
      deltaUnit: "",
      source: "DERIVED",
      info: t("kpi.whtrInfo"),
    },
    {
      id: "whr",
      name: t("kpi.whr"),
      value: currentWhr,
      unit: "",
      digits: 3,
      delta: deltaBetween(currentWhr, waistToHip(reference.waistCm, reference.hipCm), 3),
      deltaUnit: "",
      source: "DERIVED",
      info: t("kpi.whrInfo"),
    },
    {
      id: "rfm",
      name: t("kpi.rfm"),
      value: currentRfm,
      unit: t("unit.percent"),
      digits: 1,
      delta: deltaBetween(currentRfm, relativeFatMass(profile, reference.waistCm), 1),
      deltaUnit: t("unit.pp"),
      source: "ESTIMATE",
      info: t("kpi.rfmInfo"),
      unavailable: t("kpi.rfmUnavailable"),
    },
  ];

  return (
    <section className="card" aria-labelledby="body-summary-heading">
      <div className="card-head">
        <h2 id="body-summary-heading">{t("summary.microHead")}</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t("summary.sinceReference", { date: referenceLabel })}
        </p>
      </div>

      <div className="body-kpi-strip">
        {kpis.map((kpi) => (
          <KpiCell key={kpi.id} kpi={kpi} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function KpiCell({ kpi, locale }: { kpi: Kpi; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const infoId = useId();
  const t = useTranslations("bodyProgress");

  return (
    <div className="body-kpi">
      <span className="body-kpi-name">
        {kpi.name}
        {kpi.source ? <BodySourceBadge source={kpi.source} /> : null}
        {kpi.info ? (
          <button
            type="button"
            className="body-info"
            aria-expanded={open}
            aria-controls={infoId}
            aria-label={`${kpi.name}: ${t("composition.infoLabel")}`}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden="true">i</span>
          </button>
        ) : null}
      </span>

      {kpi.value == null ? (
        <span className="body-delta">{kpi.unavailable ?? "–"}</span>
      ) : (
        <>
          <span className="body-kpi-value">
            {formatMeasure(kpi.value, locale, kpi.digits)}
            {kpi.unit ? ` ${kpi.unit}` : ""}
          </span>
          <DeltaText delta={kpi.delta} unit={kpi.deltaUnit} locale={locale} digits={kpi.digits} />
        </>
      )}

      {kpi.info ? (
        <p id={infoId} className="body-info-text" hidden={!open}>
          {kpi.info}
        </p>
      ) : null}
    </div>
  );
}
