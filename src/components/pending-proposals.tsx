import Link from "next/link";
import { acceptAiProposalAction, rejectAiProposalAction } from "@/server/meal-ai-actions";
import type { PendingProposal } from "@/server/pending-proposals";

export interface PendingLabels {
  heading: string;
  intro: string;
  accept: string;
  reject: string;
  review: string;
  nothingLoggable: string;
  skipped: string;
}

/**
 * Proposals waiting for a decision, wherever the user actually is.
 *
 * Before this, a proposal was reachable only through the redirect that followed
 * submitting the meal: navigate away and it was unreachable, which is how a
 * queued meal quietly became a meal that was never logged. Accepting takes the
 * resolver's own choices in one click; the review screen is only needed to
 * change them.
 */
export function PendingProposals({
  proposals,
  labels,
  returnTo,
}: {
  proposals: PendingProposal[];
  labels: PendingLabels;
  returnTo: "/";
}) {
  if (proposals.length === 0) return null;

  return (
    <section className="card" aria-labelledby="pending-ai-heading">
      <div className="card-head">
        <div>
          <h2 id="pending-ai-heading">
            <span className="ai-badge">AI</span> {labels.heading}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            {labels.intro}
          </p>
        </div>
      </div>

      <ul className="plain-list">
        {proposals.map((proposal) => (
          <li key={proposal.proposalId} className="pending-proposal">
            <div>
              <strong>{proposal.text}</strong>
              <br />
              <span className="muted">{proposal.summary || labels.nothingLoggable}</span>
              {proposal.skipped.length ? (
                <>
                  <br />
                  <span className="muted">
                    {labels.skipped} {proposal.skipped.join(", ")}
                  </span>
                </>
              ) : null}
            </div>

            <div className="pending-actions">
              <form action={acceptAiProposalAction}>
                <input type="hidden" name="proposalId" value={proposal.proposalId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                {/* Icon plus text: the tick is never the only cue. */}
                <button className="btn btn-primary" aria-label={labels.accept}>
                  <span aria-hidden="true">✓</span> {labels.accept}
                </button>
              </form>
              <form action={rejectAiProposalAction}>
                <input type="hidden" name="proposalId" value={proposal.proposalId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className="btn btn-quiet">{labels.reject}</button>
              </form>
              <Link className="btn btn-quiet" href={`/ai-review/${proposal.mealInputId}`}>
                {labels.review}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
