import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { decideFoodReportAction } from "@/server/food-report-actions";
import type { QueuedReport } from "@/server/food-reports";

/**
 * The administrator's queue of reported foods.
 *
 * Built like the enrichment review, and for the same reason: one form per
 * report, because a report is one person's reading of one source and judging
 * its values together is the point. Two things differ, and both come from a
 * report being a *correction* rather than a backfill.
 *
 * Every row shows the value the food carries as well as the one proposed, since
 * accepting means overwriting a number a published database supplied - a
 * decision nobody should make without seeing what it replaces. And the proposed
 * number sits in an editable field rather than beside a bare tick: "nearly
 * right, but 148 not 152" is a decision the queue has to be able to express,
 * and forcing it into an all-or-nothing tick is what would push administrators
 * into editing the database by hand.
 *
 * A ticked row is applied, an unticked one is refused, and the second button
 * refuses the report entire. Both buttons post the same form, so there is only
 * ever one way a report ends.
 */
export async function FoodReportQueue({
  reports,
  nutrientNames,
  locale,
  total,
}: {
  reports: QueuedReport[];
  nutrientNames: Map<string, string>;
  locale: string;
  /** How many are open in total, when the list itself is capped. */
  total?: number;
}) {
  const t = await getTranslations("foodReports");
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="card" id="food-reports">
      <div className="card-head">
        <div>
          <h2>{t("queueTitle")}</h2>
          <p className="muted">{t("queueHint")}</p>
          {total !== undefined && total > reports.length ? (
            <p className="hint">{t("showing", { shown: reports.length, total })}</p>
          ) : null}
        </div>
      </div>

      {reports.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          {t("queueEmpty")}
        </p>
      ) : (
        <div className="stack">
          {reports.map((report) => {
            const unit = report.basisUnit === "ML" ? "ml" : "g";
            return (
              <form action={decideFoodReportAction} key={report.id} className="card" style={{ padding: 14 }}>
                <input type="hidden" name="reportId" value={report.id} />

                <div style={{ marginBottom: 10 }}>
                  <Link href={`/foods/${report.foodId}`}>
                    <strong>{report.foodName}</strong>
                  </Link>
                  {report.foodBrand ? <span className="muted"> · {report.foodBrand}</span> : null}
                  <div className="hint">
                    {t("reportedBy", { name: report.reporterName })}
                    {" · "}
                    {date.format(report.createdAt)}
                  </div>
                  {report.sourceUrl ? (
                    <div className="hint">
                      <a href={report.sourceUrl} rel="noreferrer noopener external" target="_blank" style={{ overflowWrap: "anywhere" }}>
                        {report.sourceUrl}
                      </a>
                    </div>
                  ) : null}
                </div>

                {report.comment ? (
                  <p style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>{report.comment}</p>
                ) : null}

                {report.values.length ? (
                  <div className="table-scroll">
                    <table className="table">
                      <caption className="sr-only">{t("queueTitle")}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t("accept")}</th>
                          <th scope="col">{t("nutrient")}</th>
                          <th scope="col">{t("currentColumn")}</th>
                          <th scope="col">{t("proposedColumn")}</th>
                          <th scope="col">{t("applyColumn")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.values.map((value) => (
                          <tr key={value.id}>
                            <td>
                              {/* Every id the form offered is posted, so a row
                                  that comes back without a tick is a refusal
                                  rather than something that fell off the post. */}
                              <input type="hidden" name="offered" value={value.id} />
                              <input
                                type="checkbox"
                                id={`accept-${value.id}`}
                                name="accept"
                                value={value.id}
                                aria-label={t("acceptValue", { nutrient: nutrientNames.get(value.nutrientKey) ?? value.nutrientKey })}
                              />
                            </td>
                            <th scope="row" style={{ fontWeight: 500 }}>
                              <label htmlFor={`accept-${value.id}`}>{nutrientNames.get(value.nutrientKey) ?? value.nutrientKey}</label>
                            </th>
                            <td className="muted">
                              {value.currentValue === null ? t("unknown") : number.format(value.currentValue)}
                              {/* The food moved after the report was filed. Said
                                  plainly: accepting still overwrites whatever is
                                  there now, not the number on this row. */}
                              {value.liveValue !== null ? (
                                <div className="hint">{t("changedSince", { value: number.format(value.liveValue) })}</div>
                              ) : null}
                            </td>
                            <td>{number.format(value.proposedValue)}</td>
                            <td>
                              <input
                                type="number"
                                name={`value_${value.id}`}
                                defaultValue={value.proposedValue}
                                min="0"
                                step="any"
                                inputMode="decimal"
                                style={{ maxWidth: 120 }}
                                aria-label={t("applyValue", { nutrient: nutrientNames.get(value.nutrientKey) ?? value.nutrientKey })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {report.servingSize !== null ? (
                  <div className="checkbox" style={{ marginTop: 12 }}>
                    <input type="hidden" name="servingOffered" value="1" />
                    <input type="checkbox" id={`serving-${report.id}`} name="serving" value="ACCEPT" />
                    <div>
                      <label htmlFor={`serving-${report.id}`}>
                        {t("servingDecision", {
                          current: report.currentServingSize === null ? t("unknown") : number.format(report.currentServingSize),
                          proposed: number.format(report.servingSize),
                          unit,
                        })}
                      </label>
                      <input
                        type="number"
                        name="servingValue"
                        defaultValue={report.servingSize}
                        min="0"
                        step="any"
                        inputMode="decimal"
                        style={{ maxWidth: 120, marginTop: 6 }}
                        aria-label={t("servingSize", { unit })}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor={`note-${report.id}`}>{t("reviewNote")}</label>
                  <textarea id={`note-${report.id}`} name="note" rows={2} maxLength={2000} placeholder={t("reviewNotePlaceholder")} />
                </div>

                <div className="button-row">
                  <button className="btn btn-primary" name="decision" value="apply">
                    {t("applyDecisions")}
                  </button>
                  <button className="btn btn-quiet" name="decision" value="reject">
                    {t("rejectReport")}
                  </button>
                </div>
              </form>
            );
          })}
        </div>
      )}
    </section>
  );
}
