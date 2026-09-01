import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { CopyField } from "@/components/copy-field";
import { formatDate } from "@/lib/format";
import { runDiagnostics } from "@/server/diagnostics";
import { enqueueFoodEnrichmentAction, inviteUserAction, manageAiJobsAction, resendInvitationAction, setUserActiveAction } from "@/server/admin-actions";
import { AI_JOB_OPERATIONS, AI_JOB_STATUSES, STUCK_RUNNING_MS, type AiJobStatusName } from "@/server/ai-types";
import { AI_FAILURE_KINDS } from "@/server/ai-failures";
import { AiJobsPanel, type JobLabels, type JobRow } from "./ai-jobs-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("title") };
}

const JOB_LABEL = { QUEUED: "jobQueued", RUNNING: "jobRunning", COMPLETED: "jobCompleted", FAILED: "jobFailed" } as const;
/** Cancelling is not a classifier output, but it is a reason a row can carry. */
const REASON_KINDS = [...AI_FAILURE_KINDS, "CANCELLED"];
const JOBS_PER_PAGE = 150;

/** Entity ids of the rows on this page for one entity type, deduplicated. */
const entityIds = (jobs: { entityType: string; entityId: string }[], entityType: string) => [
  ...new Set(jobs.filter((job) => job.entityType === entityType).map((job) => job.entityId)),
];
const DIAGNOSTICS_ICON: Record<string, string> = { ok: "✓", error: "×", disabled: "○", unknown: "?" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string;
    enrichmentQueued?: string;
    enrichmentRemaining?: string;
    jobs?: string;
    jobsOp?: string;
    jobsCount?: string;
  }>;
}) {
  const current = await getSessionUser();
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  if (current.role !== "ADMIN") redirect("/");

  const t = await getTranslations("admin");
  const tDiagnostics = await getTranslations("diagnostics");
  const locale = current.language;
  const { token, enrichmentQueued, enrichmentRemaining, jobs: jobsFilterRaw, jobsOp: jobsOpRaw, jobsCount } = await searchParams;
  // Never feed an unvalidated query value into a translation key.
  const jobsOp = (AI_JOB_OPERATIONS as readonly string[]).includes(jobsOpRaw ?? "")
    ? jobsOpRaw
    : jobsOpRaw === "noSelection"
      ? "noSelection"
      : undefined;
  // An unknown value in the query string must show everything, not nothing.
  const jobsFilter = (AI_JOB_STATUSES as readonly string[]).includes(jobsFilterRaw ?? "") ? (jobsFilterRaw as AiJobStatusName) : "";

  const [users, jobs, jobCountsByStatus, invitations, diagnosticsChecks] = await Promise.all([
    prisma.user.findMany({ include: { profile: true }, orderBy: { createdAt: "desc" } }),
    prisma.aiJob.findMany({
      where: jobsFilter ? { status: jobsFilter } : {},
      include: {
        proposal: { select: { approvalStatus: true } },
        mealInput: { select: { text: true, sourceUrl: true } },
        // Newest first. Ordering by `attempt` would interleave the numbers of a
        // job that was manually run again, because a rerun resets the counter.
        attempts: { orderBy: { createdAt: "desc" }, take: 10 },
      },
      orderBy: { createdAt: "desc" },
      take: JOBS_PER_PAGE,
    }),
    prisma.aiJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.userInvitation.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    runDiagnostics(),
  ]);

  const jobCounts = { ALL: 0, QUEUED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 } as Record<AiJobStatusName | "ALL", number>;
  for (const group of jobCountsByStatus) {
    jobCounts[group.status] = group._count._all;
    jobCounts.ALL += group._count._all;
  }

  // What the job was actually asked to do. It lives on a different record for
  // each entity type, and it is the single most useful thing to see next to a
  // failure, so it is fetched for the rows on this page rather than guessed at.
  const [researchInputs, recipeImportInputs] = await Promise.all([
    prisma.researchJob.findMany({
      where: { id: { in: entityIds(jobs, "RESEARCH") } },
      select: { id: true, query: true },
    }),
    prisma.recipeImport.findMany({
      where: { id: { in: entityIds(jobs, "RECIPE_IMPORT") } },
      select: { id: true, text: true, sourceUrl: true },
    }),
  ]);
  const researchById = new Map(researchInputs.map((row) => [row.id, row]));
  const recipeImportById = new Map(recipeImportInputs.map((row) => [row.id, row]));

  const jobInput = (job: (typeof jobs)[number]) => {
    if (job.mealInput?.text) return { text: job.mealInput.text, sourceUrl: job.mealInput.sourceUrl };
    const research = researchById.get(job.entityId);
    if (research) return { text: research.query, sourceUrl: null };
    const recipeImport = recipeImportById.get(job.entityId);
    if (recipeImport) return { text: recipeImport.text, sourceUrl: recipeImport.sourceUrl };
    return { text: null, sourceUrl: job.mealInput?.sourceUrl ?? null };
  };

  const stuckBefore = Date.now() - STUCK_RUNNING_MS;
  const jobRows: JobRow[] = jobs.map((job) => {
    const finishedAt = job.completedAt ?? job.failedAt;
    const input = jobInput(job);
    return {
      id: job.id,
      entityType: job.entityType,
      entityId: job.entityId,
      status: job.status,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      model: job.model,
      failureKind: job.failureKind,
      errorMessage: job.errorMessage,
      errorDetail: job.errorDetail,
      createdAt: formatDate(job.createdAt, locale, { dateStyle: "medium", timeStyle: "short" }),
      durationSeconds:
        job.startedAt && finishedAt ? Math.round((finishedAt.getTime() - job.startedAt.getTime()) / 100) / 10 : null,
      stuck: job.status === "RUNNING" && Boolean(job.startedAt && job.startedAt.getTime() < stuckBefore),
      input: input.text ? input.text.slice(0, 400) : null,
      sourceUrl: input.sourceUrl ?? null,
      reviewStatus: job.proposal?.approvalStatus ?? null,
      attempts: job.attempts.map((attempt) => ({
        id: attempt.id,
        attempt: attempt.attempt,
        kind: attempt.kind,
        message: attempt.message,
        detail: attempt.detail,
        durationMs: attempt.durationMs,
        at: formatDate(attempt.createdAt, locale, { dateStyle: "short", timeStyle: "medium" }),
      })),
    };
  });

  const jobLabels: JobLabels = {
    entity: t("entity"),
    status: t("status"),
    created: t("created"),
    retries: t("retries"),
    model: t("model"),
    reason: t("jobReason"),
    statusLabels: Object.fromEntries(AI_JOB_STATUSES.map((status) => [status, t(JOB_LABEL[status])])) as JobLabels["statusLabels"],
    operations: Object.fromEntries(AI_JOB_OPERATIONS.map((operation) => [operation, t(`op.${operation}` as "op.requeue")])) as JobLabels["operations"],
    kinds: Object.fromEntries(REASON_KINDS.map((kind) => [kind, t(`kind.${kind}` as "kind.UNKNOWN")])),
    hints: Object.fromEntries(REASON_KINDS.map((kind) => [kind, t(`hint.${kind}` as "hint.UNKNOWN")])),
    selectAll: t("selectAll"),
    selectNone: t("selectNone"),
    selectedLabel: t("selectedLabel"),
    selectRow: t("selectRow"),
    filterAll: t("filterAll"),
    onSelection: t("onSelection"),
    sweeps: t("sweeps"),
    details: t("jobDetails"),
    attemptHistory: t("attemptHistory"),
    attemptLabel: t("attemptLabel"),
    noAttempts: t("noAttempts"),
    input: t("jobInput"),
    source: t("jobSource"),
    review: t("reviewLabel"),
    stuck: t("jobStuck"),
    confirmDelete: t("confirmDestructive"),
    noJobs: t("noJobs"),
    jobId: t("jobId"),
  };

  const invitationLink = token
    ? new URL(`/invite/${token}`, process.env.APP_URL ?? "http://localhost:3000").toString()
    : null;

  const invitationStatus = (invitation: (typeof invitations)[number]) => {
    if (invitation.acceptedAt) return t("statusAccepted");
    if (invitation.revokedAt) return t("statusReplaced");
    return invitation.expiresAt <= new Date() ? t("statusExpired") : t("statusPending");
  };

  return (
    <AppShell displayName={current.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("subtitle")}
          </p>
        </div>
      </div>

      {invitationLink ? (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2>{t("invitationLink")}</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            {t("invitationLinkHint")}
          </p>
          <CopyField value={invitationLink} label={t("invitationLink")} copyLabel={t("copy")} copiedLabel={t("copied")} />
        </section>
      ) : null}

      <div className="admin-grid">
        <section className="card">
          <h2>{t("invite")}</h2>
          <form action={inviteUserAction}>
            <div className="field">
              <label htmlFor="email">{t("email")}</label>
              <input id="email" name="email" type="email" required />
            </div>
            <div className="field">
              <label htmlFor="name">{t("name")}</label>
              <input id="name" name="name" />
            </div>
            <div className="field">
              <label htmlFor="role">{t("role")}</label>
              <select id="role" name="role">
                <option value="USER">{t("roleUser")}</option>
                <option value="ADMIN">{t("roleAdmin")}</option>
              </select>
            </div>
            <button className="btn btn-primary">{t("sendInvitation")}</button>
          </form>
        </section>

        <section className="card">
          <h2>{t("recentInvitations")}</h2>
          {invitations.length === 0 ? (
            <p className="muted">{t("noInvitations")}</p>
          ) : (
            <ul className="plain-list">
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  <strong>{invitation.email}</strong>
                  <br />
                  <span className="muted">
                    {invitationStatus(invitation)} ·{" "}
                    {t("expires", { date: formatDate(invitation.expiresAt, locale, { dateStyle: "medium" }) })}
                  </span>
                  {!invitation.acceptedAt && !invitation.revokedAt ? (
                    <form action={resendInvitationAction}>
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <button className="btn btn-quiet">{t("resend")}</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>{t("users")}</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("user")}</th>
                <th>{t("role")}</th>
                <th>{t("status")}</th>
                <th>{t("action")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.profile?.displayName ?? user.username}</strong>
                    <br />
                    <span className="muted">{user.email}</span>
                  </td>
                  <td>{user.role === "ADMIN" ? t("roleAdmin") : t("roleUser")}</td>
                  <td>
                    {user.active ? t("active") : t("inactive")}
                    {user.mustChangePassword ? ` · ${t("mustChangePassword")}` : ""}
                  </td>
                  <td>
                    <form action={setUserActiveAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="active" value={String(!user.active)} />
                      <button className="btn btn-quiet" disabled={user.id === current.id}>
                        {user.active ? t("deactivate") : t("reactivate")}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }} id="ai-jobs">
        <div className="card-head">
          <div>
            <h2>{t("aiJobs")}</h2>
            <p className="muted">{t("enrichmentHint")}</p>
          </div>
          <form action={enqueueFoodEnrichmentAction}>
            <button className="btn btn-primary">{t("enqueueEnrichment")}</button>
          </form>
        </div>
        {enrichmentQueued !== undefined ? (
          <p>
            {t("enrichmentQueued", { count: Number(enrichmentQueued) })}
            {Number(enrichmentRemaining ?? 0) > 0
              ? ` ${t("enrichmentRemaining", { count: Number(enrichmentRemaining) })}`
              : ""}
          </p>
        ) : null}
        {jobsOp ? (
          <div className={jobsOp === "noSelection" ? "notice notice-warn" : "notice"}>
            <span className="notice-icon" aria-hidden="true">
              {jobsOp === "noSelection" ? "!" : "i"}
            </span>
            <span>
              {jobsOp === "noSelection"
                ? t("noSelectionWarning")
                : t("operationDone", { count: Number(jobsCount ?? 0), operation: t(`op.${jobsOp}` as "op.requeue") })}
            </span>
          </div>
        ) : null}
        <AiJobsPanel jobs={jobRows} counts={jobCounts} filter={jobsFilter} labels={jobLabels} action={manageAiJobsAction} />
        {jobCounts.ALL > jobRows.length ? (
          <p className="muted">{t("jobsTruncated", { shown: jobRows.length, total: jobCounts.ALL })}</p>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <div>
            <h2>{tDiagnostics("title")}</h2>
            <p className="muted">{tDiagnostics("subtitle")}</p>
          </div>
          <Link className="btn" href="/admin">
            {tDiagnostics("refresh")}
          </Link>
        </div>
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">{tDiagnostics("title")}</caption>
            <thead>
              <tr>
                <th scope="col">{tDiagnostics("title")}</th>
                <th scope="col">{tDiagnostics("status.unknown")}</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {diagnosticsChecks.map((check) => (
                <tr key={check.key}>
                  <th scope="row" style={{ fontWeight: 500 }}>
                    {tDiagnostics(check.key as "database")}
                  </th>
                  <td>
                    {/* Status is icon + text, never colour alone. */}
                    <span aria-hidden="true">{DIAGNOSTICS_ICON[check.status]}</span>{" "}
                    {tDiagnostics(`status.${check.status}` as "status.ok")}
                  </td>
                  <td className="muted">{check.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
