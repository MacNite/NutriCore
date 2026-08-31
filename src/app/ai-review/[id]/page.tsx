import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { reviewAiProposalAction } from "@/server/meal-ai-actions";
import type { AcceptedOutcome, ProposedComponent } from "@/server/ai-types";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("aiReview");
  return { title: t("title") };
}

const STATUS_LABEL = {
  QUEUED: "statusQueued",
  RUNNING: "statusRunning",
  COMPLETED: "statusCompleted",
  FAILED: "statusFailed",
} as const;

export default async function AiReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const t = await getTranslations("aiReview");

  const input = await prisma.mealInput.findFirst({
    where: { id, userId: user.id },
    include: { aiJobs: { include: { proposal: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!input) redirect("/diary");

  const job = input.aiJobs[0];
  const proposal = job?.proposal;
  const proposed = proposal?.proposed as { components?: ProposedComponent[]; warnings?: string[] } | undefined;
  const outcome = proposal?.accepted as AcceptedOutcome | null | undefined;
  const pending = job?.status === "QUEUED" || job?.status === "RUNNING";

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("intro")}
          </p>
        </div>
        <Link className="btn btn-quiet" href="/diary">
          {t("back")}
        </Link>
      </div>

      <section className="card">
        <h2>{input.text}</h2>
        <p>
          <span className={`ai-state ai-${job?.status.toLowerCase()}`}>{job ? t(STATUS_LABEL[job.status]) : t("statusFailed")}</span>
        </p>
        {pending ? <p className="muted">{t("keepWorking")}</p> : null}
        {job?.errorMessage ? <div className="notice notice-warn">{job.errorMessage}</div> : null}
      </section>

      {proposal && proposed ? (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="card-head">
            <h2>
              <span className="ai-badge">AI</span> {t("proposed")}
            </h2>
            <span className="muted">{t("confidence", { value: proposal.confidence })}</span>
          </div>

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("food")}</th>
                  <th>{t("quantity")}</th>
                  <th>{t("portion")}</th>
                  <th>{t("resolution")}</th>
                </tr>
              </thead>
              <tbody>
                {proposed.components?.map((component, index) => (
                  <tr key={index}>
                    <td>
                      <strong>{component.name}</strong>
                      {component.preparation ? (
                        <>
                          <br />
                          <span className="muted">{component.preparation}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {component.quantity ?? "—"} {component.unit ?? ""}
                    </td>
                    <td>{component.estimatedGrams ? t("estimated", { grams: component.estimatedGrams }) : "—"}</td>
                    <td>
                      {component.canonicalFoodId ? t("matched") : t("unmatched")}
                      {component.sources?.[0]?.url ? (
                        <>
                          <br />
                          <a href={component.sources[0].url} rel="noreferrer" target="_blank">
                            {component.sources[0].title}
                          </a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details>
            <summary>{t("provenance")}</summary>
            <pre className="provenance">{JSON.stringify(proposal.provenance, null, 2)}</pre>
          </details>

          {proposal.approvalStatus === "PENDING" ? (
            <form action={reviewAiProposalAction} className="button-row">
              <input type="hidden" name="proposalId" value={proposal.id} />
              <button className="btn btn-primary" name="decision" value="accept">
                {t("accept")}
              </button>
              <button className="btn btn-quiet" name="decision" value="reject">
                {t("reject")}
              </button>
            </form>
          ) : proposal.approvalStatus === "ACCEPTED" ? (
            <div>
              <p>
                <strong>{t("approved")}</strong>
              </p>
              {outcome && outcome.logged.length > 0 ? (
                <p>{t("logged", { count: outcome.logged.length, total: outcome.logged.length + outcome.skipped.length })}</p>
              ) : (
                <p>{t("nothingLogged")}</p>
              )}
              {outcome && outcome.skipped.length > 0 ? (
                <>
                  <p className="muted">{t("skipped")}</p>
                  <ul className="plain-list">
                    {outcome.skipped.map((name) => (
                      <li key={name}>
                        {name} — <Link href="/foods">{t("addManually")}</Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : (
            <p>
              <strong>{t("rejected")}</strong>
            </p>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
