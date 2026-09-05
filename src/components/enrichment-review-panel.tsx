import { getTranslations } from "next-intl/server";
import { reviewEnrichmentAction } from "@/server/enrichment-actions";
import type { PendingProposal } from "@/server/enrichment-review";

/**
 * The review surface for proposed nutrition, used by both queues.
 *
 * One form per proposal, because a decision is per source: the values on it were
 * all read off the same page, and judging them together is the point. Every
 * value is ticked by default - the common case is "this page is right" - and a
 * box left unticked is an explicit refusal rather than an omission. An unticked
 * checkbox posts nothing at all, so the form also posts every id it offered:
 * the action refuses exactly the ones that came back without a tick.
 *
 * A value that is already applied is labelled as such. Those are the ones the
 * backfill wrote before review existed: approving keeps them, refusing takes
 * them off the food again.
 */
export async function EnrichmentReviewPanel({
  proposals,
  nutrientNames,
  locale,
  heading,
  emptyText,
  total,
}: {
  proposals: PendingProposal[];
  nutrientNames: Map<string, string>;
  locale: string;
  heading: string;
  emptyText?: string;
  /** How many are open in total, when the list itself is capped. */
  total?: number;
}) {
  const t = await getTranslations("enrichmentReview");
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <section className="card" id="enrichment-review">
      <div className="card-head">
        <div>
          <h2>{heading}</h2>
          <p className="muted">{t("hint")}</p>
          {total !== undefined && total > proposals.length ? (
            <p className="hint">{t("showing", { shown: proposals.length, total })}</p>
          ) : null}
        </div>
      </div>

      {proposals.length === 0 ? (
        <p className="muted">{emptyText ?? t("empty")}</p>
      ) : (
        <div className="stack">
          {proposals.map((proposal) => (
            <form action={reviewEnrichmentAction} key={proposal.id} className="card" style={{ padding: 14 }}>
              <input type="hidden" name="proposalId" value={proposal.id} />

              <div style={{ marginBottom: 10 }}>
                <strong>{proposal.foodName}</strong>
                {proposal.foodBrand ? <span className="muted"> · {proposal.foodBrand}</span> : null}
                <div className="hint">
                  {proposal.sourceUrl ? (
                    <a href={proposal.sourceUrl} rel="noreferrer noopener external" target="_blank" style={{ overflowWrap: "anywhere" }}>
                      {proposal.sourceUrl}
                    </a>
                  ) : (
                    t("noSource")
                  )}
                  {" · "}
                  {date.format(proposal.retrievedAt)}
                  {proposal.model ? ` · ${proposal.model}` : ""}
                </div>
              </div>

              <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0 }}>
                {proposal.values.map((value) => (
                  <li key={value.id} className="checkbox">
                    <input type="checkbox" id={`v-${value.id}`} name="approve" value={value.id} defaultChecked />
                    {/* What was on the page. Everything here that comes back
                        without a tick is a refusal. */}
                    <input type="hidden" name="offered" value={value.id} />
                    <div>
                      <label htmlFor={`v-${value.id}`}>
                        {nutrientNames.get(value.nutrientKey) ?? value.nutrientKey}: {number.format(value.value)}
                      </label>
                      {value.applied ? <div className="hint">{t("alreadyApplied")}</div> : null}
                    </div>
                  </li>
                ))}
                {proposal.servingSizeG !== null ? (
                  <li className="checkbox">
                    <input type="checkbox" id={`s-${proposal.id}`} name="serving" value="APPROVE" defaultChecked />
                    <input type="hidden" name="servingOffered" value="1" />
                    <div>
                      <label htmlFor={`s-${proposal.id}`}>
                        {t("servingSize", { grams: number.format(proposal.servingSizeG) })}
                      </label>
                      {proposal.servingApplied ? <div className="hint">{t("alreadyApplied")}</div> : null}
                    </div>
                  </li>
                ) : null}
              </ul>

              <button className="btn btn-primary">{t("submit")}</button>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
