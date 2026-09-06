import { getTranslations } from "next-intl/server";
import type { OwnReport } from "@/server/food-reports";

/**
 * What has been reported about this food, as the people looking at it see it.
 *
 * Two different readers meet here. Anybody who opens a food with an undecided
 * report is told that its numbers are disputed - that is the whole point of a
 * flag, and it is worth knowing before logging a meal from it. The reporter
 * additionally sees their own reports and what became of them: a report that
 * vanished on submit is indistinguishable from one that was never filed, and an
 * instance with one administrator can take a while to answer.
 *
 * Who reported it is never shown here. The queue tells an administrator; a food
 * page telling everybody else would make reporting a wrong number a small
 * public act.
 */
export async function FoodReportStatus({
  reports,
  openByAnyone,
  locale,
  nutrientNames,
}: {
  /** The signed-in member's own reports on this food, newest first. */
  reports: OwnReport[];
  /** Whether anybody at all has one waiting for a decision. */
  openByAnyone: boolean;
  locale: string;
  nutrientNames: Map<string, string>;
}) {
  const t = await getTranslations("foodReports");
  if (!openByAnyone && reports.length === 0) return null;

  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  return (
    <section className="card" aria-labelledby="food-report-status">
      <h2 id="food-report-status">{t("statusTitle")}</h2>

      {openByAnyone ? (
        <div className="notice notice-warn" style={{ marginBottom: reports.length ? 14 : 0 }}>
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <span>{t("disputed")}</span>
        </div>
      ) : null}

      {reports.length ? (
        <ul className="plain-list">
          {reports.map((report) => (
            <li key={report.id}>
              <strong>{t(`state.${report.status}` as "state.OPEN")}</strong>
              <span className="muted">
                {" · "}
                {date.format(report.createdAt)}
                {report.reviewedAt ? ` · ${t("decidedOn", { date: date.format(report.reviewedAt) })}` : ""}
              </span>
              {report.values.length ? (
                <div className="hint">
                  {report.values
                    .map((value) => {
                      const name = nutrientNames.get(value.nutrientKey) ?? value.nutrientKey;
                      // What was written, when a reviewer settled on a different
                      // number than the one proposed: the reporter should not
                      // have to open the food to find that out.
                      return value.decidedValue !== null && value.decidedValue !== value.proposedValue
                        ? `${name}: ${number.format(value.proposedValue)} → ${number.format(value.decidedValue)}`
                        : `${name}: ${number.format(value.proposedValue)}`;
                    })
                    .join(" · ")}
                </div>
              ) : null}
              {report.reviewNote ? <div className="hint">{t("note", { note: report.reviewNote })}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
