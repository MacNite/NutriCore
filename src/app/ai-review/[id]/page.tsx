import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { reviewAiProposalAction } from "@/server/meal-ai-actions";
import { componentGrams, type AcceptedOutcome, type ProposedComponent } from "@/server/ai-types";
import { ComponentChoice, type ChoiceLabels } from "./component-choice";

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
  if (!input) redirect("/");

  const job = input.aiJobs[0];
  const proposal = job?.proposal;
  const proposed = proposal?.proposed as { components?: ProposedComponent[]; warnings?: string[] } | undefined;
  const outcome = proposal?.accepted as AcceptedOutcome | null | undefined;
  const pending = job?.status === "QUEUED" || job?.status === "RUNNING";
  const pendingReview = proposal?.approvalStatus === "PENDING";
  const urlFailure = job?.errorMessage === "source-unsupported-content" ? "unsupportedContent"
    : job?.errorMessage === "source-too-large" ? "oversizedPage"
    : job?.errorMessage === "source-no-ingredients" ? "noIngredients"
    : job?.failureKind === "SOURCE_BLOCKED" ? "unsafeUrl"
    : job?.failureKind === "SOURCE_UNAVAILABLE" ? "unreachablePage"
    : job?.status === "FAILED" ? "extractionFailure"
    : null;

  // Built here so `ComponentChoice` stays free of translation plumbing.
  const choiceLabels: ChoiceLabels = {
    matched: t("matched"),
    unmatched: t("unmatched"),
    missingWeight: t("missingWeight"),
    modelEstimate: t("modelEstimate"),
    skip: t("skipComponent"),
    origin: {
      LOCAL: t("origin.LOCAL"),
      OPEN_FOOD_FACTS: t("origin.OPEN_FOOD_FACTS"),
      WEB_EXTRACT: t("origin.WEB_EXTRACT"),
    },
    gramsSource: {
      SERVING: t("gramsSource.SERVING"),
      PORTION: t("gramsSource.PORTION"),
      UNIT: t("gramsSource.UNIT"),
      MODEL: t("gramsSource.MODEL"),
      NONE: "",
    },
  };

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("intro")}
          </p>
        </div>
      </div>

      <section className="card">
        <h2>{input.text}</h2>
        <p>
          <span className={`ai-state ai-${job?.status.toLowerCase()}`}>{job ? t(STATUS_LABEL[job.status]) : t("statusFailed")}</span>
        </p>
        {pending ? (
          <>
            <p className="muted">{t("keepWorking")}</p>
            <AutoRefresh />
          </>
        ) : null}
        {job?.errorMessage ? <div className="notice notice-warn">{urlFailure ? t(`urlErrors.${urlFailure}`) : job.errorMessage}</div> : null}
      </section>

      {proposal && proposed ? (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="card-head">
            <h2>
              <span className="ai-badge">AI</span> {t("proposed")}
            </h2>
            <span className="muted">{t("confidence", { value: proposal.confidence })}</span>
          </div>

          {/* The table is inside the form: the choice per component and the
              approval are one submission, so nothing can be approved against a
              selection that was never sent. */}
          <form action={reviewAiProposalAction}>
            <input type="hidden" name="proposalId" value={proposal.id} />
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
                {proposed.components?.map((component, index) => {
                  // Against the selected food: the component-level weight is
                  // only the model's reading, and is null for "2 Scheiben".
                  const grams = componentGrams(component, component.canonicalFoodId);
                  return (
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
                    <td>
                      {grams ? t("estimated", { grams: Math.round(grams) }) : "—"}
                    </td>
                    <td>
                      <ComponentChoice
                        component={component}
                        index={index}
                        labels={choiceLabels}
                        readOnly={!pendingReview}
                      />
                    </td>
                  </tr>
                  );
                })}
                </tbody>
              </table>
            </div>

            {pendingReview ? (
              <div className="button-row">
                <button className="btn btn-primary" name="decision" value="accept">
                  {t("accept")}
                </button>
                <button className="btn btn-quiet" name="decision" value="reject">
                  {t("reject")}
                </button>
              </div>
            ) : null}
          </form>

          <details>
            <summary>{t("provenance")}</summary>
            <pre className="provenance">{JSON.stringify(proposal.provenance, null, 2)}</pre>
          </details>

          {proposal.approvalStatus === "PENDING" ? null : proposal.approvalStatus === "ACCEPTED" ? (
            <div>
              <p>
                <strong>{t("approved")}</strong>
              </p>
              {outcome && outcome.logged.length > 0 ? (
                <>
                  <p>{t("logged", { count: outcome.logged.length, total: outcome.logged.length + outcome.skipped.length })}</p>
                  {outcome.estimated?.length ? (
                    <div className="notice notice-warn">
                      <span className="notice-icon" aria-hidden="true">
                        !
                      </span>
                      <span>{t("loggedAsEstimate", { names: outcome.estimated.join(", ") })}</span>
                    </div>
                  ) : null}
                </>
              ) : (
                <p>{t("nothingLogged")}</p>
              )}
              {outcome && outcome.skipped.length > 0 ? (
                <>
                  <p className="muted">{t("skipped")}</p>
                  <ul className="plain-list">
                    {outcome.skipped.map((name, index) => (
                      <li key={`${name}-${index}`}>
                        {name} — {outcome.skippedDetails?.[index]
                          ? t(`skipReason.${outcome.skippedDetails[index].reason}`)
                          : t("skipReason.LEGACY")} — <Link href="/foods">{t("addManually")}</Link>
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
