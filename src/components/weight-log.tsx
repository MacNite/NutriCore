import { getTranslations } from "next-intl/server";
import { hasTrendLine } from "@/lib/weight";
import { weightSummary } from "./weight-summary";
import { formatDate, formatNumber } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

/** Rows arrive newest first, the way the log reads top-down. */
export interface WeightRow {
  id: string;
  date: string;
  weightKg: number;
  note: string | null;
}

const VISIBLE_ROWS = 7;

/**
 * A one-line summary and the raw entries, folded away so the card opens at a
 * glance. The line over time is the measurement series above; this is the log
 * behind it, including the notes. Longer logs scroll inside the panel instead
 * of stretching the page.
 */
export async function WeightLog({ rows, locale }: { rows: WeightRow[]; locale: Locale }) {
  const t = await getTranslations("progress");
  const points = [...rows].reverse().map(({ date, weightKg }) => ({ date, weightKg }));
  const summary = await weightSummary(points, locale);

  return (
    <details className="weight-log">
      <summary className="weight-log-toggle">
        <span>{t("entries", { count: rows.length })}</span>
        <span className="weight-log-chevron" aria-hidden="true" />
      </summary>

      <div className="weight-log-content">
        {summary ? (
          <p className="muted weight-log-summary">
            {summary}
            {` · ${hasTrendLine(points) ? t("trend") : t("needMoreData")}`}
          </p>
        ) : null}

        <div className={`table-scroll${rows.length > VISIBLE_ROWS ? " table-scroll-y" : ""}`}>
          <table className="table">
            <caption className="sr-only">{t("weight")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("date")}</th>
                <th scope="col" className="num">
                  {t("weightValue")}
                </th>
                <th scope="col">{t("note")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.date, locale)}</td>
                  <td className="num">{formatNumber(row.weightKg, locale)} kg</td>
                  <td>{row.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
