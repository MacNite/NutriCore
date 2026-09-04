"use client";

import { useTranslations } from "next-intl";
import { NUTRIENTS } from "@/lib/nutrients";
import { formatNutrient } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

/** An extra column of values, headed by the portion they belong to. */
export interface NutrientColumn {
  /** Column heading, e.g. "for 200 g". */
  label: string;
  /** Second heading line, e.g. the resolved weight of a named portion. */
  hint?: string | null;
  /** Values for the column, or null when the portion cannot be resolved. */
  nutrients: Record<string, number | null> | null;
}

/**
 * Renders every nutrient in the catalogue. An unknown value shows a dash with
 * an explicit "unknown" label for screen readers, never a zero.
 */
export function NutrientTable({
  nutrients,
  basisAmount,
  basisUnit,
  locale,
  column,
}: {
  nutrients: Record<string, number | null>;
  basisAmount: number;
  basisUnit: string;
  locale: Locale;
  column?: NutrientColumn | null;
}) {
  const t = useTranslations("nutrients");
  const common = useTranslations("common");
  const foods = useTranslations("foods");

  const rows = NUTRIENTS.filter((n) => nutrients[n.key] !== undefined || n.category !== "vitamin");
  const basisLabel = foods("perBasis", { amount: String(basisAmount), unit: basisUnit === "ML" ? "ml" : "g" });

  const value = (values: Record<string, number | null> | null, key: string, unit: string) => {
    const amount = values ? (values[key] ?? null) : null;
    return amount === null ? (
      <>
        <span aria-hidden="true">–</span>
        <span className="sr-only">{common("unknown")}</span>
      </>
    ) : (
      `${formatNutrient(amount, locale)} ${unit}`
    );
  };

  return (
    <div className="table-scroll">
      <table className={column ? "table nutrient-table" : "table"}>
        <caption className="sr-only">{basisLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{foods("form.nutrients")}</th>
            <th scope="col" className="num">
              {basisLabel}
            </th>
            {column ? (
              <th scope="col" className="num">
                {column.label}
                {column.hint ? (
                  <>
                    <br />
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {column.hint}
                    </span>
                  </>
                ) : null}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((nutrient) => (
            <tr key={nutrient.key}>
              <th scope="row" style={{ fontWeight: 500 }}>
                {t(nutrient.key as "protein")}
              </th>
              <td className="num">{value(nutrients, nutrient.key, nutrient.unit)}</td>
              {column ? (
                <td className="num" style={{ fontWeight: 600 }}>
                  {value(column.nutrients, nutrient.key, nutrient.unit)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
