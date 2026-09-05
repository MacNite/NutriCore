import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { CopyField } from "@/components/copy-field";
import { formatDate } from "@/lib/format";
import { runDiagnostics } from "@/server/diagnostics";
import { datasetStatus } from "@/server/food-datasets/import";
import { batchInviteUsersAction, enqueueFoodEnrichmentAction, importFoodDatasetsAction, inviteUserAction, manageAiJobsAction, resendInvitationAction, saveMailSettingsAction, setUserActiveAction } from "@/server/admin-actions";
import { AI_JOB_OPERATIONS, AI_JOB_STATUSES, STUCK_RUNNING_MS, jobOutcome, type AcceptedOutcome, type AiJobStatusName } from "@/server/ai-types";
import { AI_FAILURE_KINDS } from "@/server/ai-failures";
import { AiJobsPanel, type JobLabels, type JobRow } from "./ai-jobs-panel";
import { PrivacyAiPanel } from "@/components/privacy-ai-panel";
import { getMailConfiguration } from "@/lib/mail";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("title") };
}

const JOB_LABEL = { QUEUED: "jobQueued", RUNNING: "jobRunning", COMPLETED: "jobCompleted", FAILED: "jobFailed" } as const;
/** Cancelling is not a classifier output, but it is a reason a row can carry. */
const REASON_KINDS = [...AI_FAILURE_KINDS, "CANCELLED"];

/** Why a sweep queued nothing. Checked against the URL so no arbitrary key is looked up. */
const ENRICHMENT_BLOCKS: string[] = ["SERVER_DISABLED", "NO_SEARCH_PROVIDER", "USER_DECLINED"];
const JOBS_PER_PAGE = 50;

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
    mail?: string;
    batchSent?: string;
    batchFailed?: string;
    mailSettings?: string;
    enrichmentQueued?: string;
    enrichmentRemaining?: string;
    enrichmentBlocked?: string;
    datasetsImported?: string;
    datasetsSkipped?: string;
    datasetsFailed?: string;
    jobs?: string;
    jobsPage?: string;
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
  const { token, mail, batchSent, batchFailed, mailSettings, enrichmentQueued, enrichmentRemaining, enrichmentBlocked, datasetsImported, datasetsSkipped, datasetsFailed, jobs: jobsFilterRaw, jobsPage: jobsPageRaw, jobsOp: jobsOpRaw, jobsCount } = await searchParams;
  // Never feed an unvalidated query value into a translation key.
  const jobsOp = (AI_JOB_OPERATIONS as readonly string[]).includes(jobsOpRaw ?? "")
    ? jobsOpRaw
    : jobsOpRaw === "noSelection"
      ? "noSelection"
      : undefined;
  // An unknown value in the query string must show everything, not nothing.
  const jobsFilter = (AI_JOB_STATUSES as readonly string[]).includes(jobsFilterRaw ?? "") ? (jobsFilterRaw as AiJobStatusName) : "";

  // Counted before the rows are fetched: how many pages there are decides which
  // page may be asked for, so a hand-edited `jobsPage` cannot land past the end.
  const jobCountsByStatus = await prisma.aiJob.groupBy({ by: ["status"], _count: { _all: true } });
  const jobCounts = { ALL: 0, QUEUED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 } as Record<AiJobStatusName | "ALL", number>;
  for (const group of jobCountsByStatus) {
    jobCounts[group.status] = group._count._all;
    jobCounts.ALL += group._count._all;
  }
  const jobsTotal = jobsFilter ? jobCounts[jobsFilter] : jobCounts.ALL;
  const jobsPageCount = Math.max(1, Math.ceil(jobsTotal / JOBS_PER_PAGE));
  const jobsPage = Math.min(Math.max(1, Math.trunc(Number(jobsPageRaw)) || 1), jobsPageCount);

  const [users, jobs, invitations, diagnosticsChecks, ownProfile, mailConfiguration, datasets] = await Promise.all([
    prisma.user.findMany({ include: { profile: true }, orderBy: { createdAt: "desc" } }),
    prisma.aiJob.findMany({
      where: jobsFilter ? { status: jobsFilter } : {},
      include: {
        // `accepted` is what an approved proposal actually wrote to the diary,
        // which is the outcome of a meal job.
        proposal: { select: { approvalStatus: true, accepted: true } },
        ingestionInput: { select: { text: true, sourceUrl: true } },
        // Newest first. Ordering by `attempt` would interleave the numbers of a
        // job that was manually run again, because a rerun resets the counter.
        attempts: { orderBy: { createdAt: "desc" }, take: 10 },
      },
      orderBy: { createdAt: "desc" },
      skip: (jobsPage - 1) * JOBS_PER_PAGE,
      take: JOBS_PER_PAGE,
    }),
    prisma.userInvitation.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    runDiagnostics(),
    // The AI consent switches act on the signed-in administrator's own profile,
    // which is where they lived before they moved off the settings page.
    prisma.userProfile.findUnique({ where: { userId: current.id } }),
    getMailConfiguration(),
    datasetStatus(),
  ]);

  // What the job was actually asked to do. It lives on a different record for
  // each entity type, and it is the single most useful thing to see next to a
  // failure, so it is fetched for the rows on this page rather than guessed at.
  // The same lookups name the entity: an opaque cuid says nothing about which
  // food or recipe a row is, which is what the id column used to be on its own.
  const [researchInputs, enrichedFoods] = await Promise.all([
    prisma.researchJob.findMany({
      where: { id: { in: entityIds(jobs, "RESEARCH") } },
      select: { id: true, query: true },
    }),
    prisma.food.findMany({
      where: { id: { in: entityIds(jobs, "FOOD_ENRICHMENT") } },
      select: { id: true, name: true },
    }),
  ]);
  const researchById = new Map(researchInputs.map((row) => [row.id, row]));
  const foodNameById = new Map(enrichedFoods.map((row) => [row.id, row.name]));

  /** Truncated so one long meal description cannot take over the column. */
  const shorten = (value: string | null | undefined, max = 80) =>
    !value ? null : value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;

  /**
   * The name of the thing a job worked on. A meal input and a recipe log both
   * carry it as the input text; the other kinds keep it on their own record.
   */
  const entityName = (job: (typeof jobs)[number]) => {
    if (job.entityType === "FOOD_ENRICHMENT") return shorten(foodNameById.get(job.entityId));
    if (job.entityType === "RESEARCH") return shorten(researchById.get(job.entityId)?.query);
    return shorten(job.ingestionInput?.text);
  };

  const jobInput = (job: (typeof jobs)[number]) => {
    if (job.ingestionInput?.text) return { text: job.ingestionInput.text, sourceUrl: job.ingestionInput.sourceUrl };
    const research = researchById.get(job.entityId);
    if (research) return { text: research.query, sourceUrl: null };
    return { text: null, sourceUrl: job.ingestionInput?.sourceUrl ?? null };
  };

  /**
   * What a finished job left behind, as short labelled facts.
   *
   * "COMPLETED" on its own never said whether an enrichment filled anything or
   * a meal reached the diary, which is the question the reason column is read
   * for. Meal jobs take it from the approved proposal, which is where the diary
   * write is recorded; the other kinds take it from the outcome the worker
   * stores on the job. Jobs finished before this existed simply have none.
   */
  const jobResult = (job: (typeof jobs)[number]) => {
    const facts: { label: string; value: string }[] = [];
    const outcome = jobOutcome(job.metadata);
    const accepted = job.proposal?.accepted as AcceptedOutcome | null;

    if (accepted?.logged?.length) facts.push({ label: t("resultLogged"), value: accepted.logged.join(", ") });
    if (accepted?.skipped?.length) facts.push({ label: t("resultSkipped"), value: accepted.skipped.join(", ") });
    if (outcome?.nutrientKeys?.length) facts.push({ label: t("resultNutrients"), value: outcome.nutrientKeys.join(", ") });
    if (outcome?.servingFilled) facts.push({ label: t("resultServing"), value: t("resultServingSet") });
    if (outcome?.recipeName)
      facts.push({
        label: t("resultRecipe"),
        value: outcome.ingredientCount === undefined
          ? outcome.recipeName
          : `${outcome.recipeName} (${t("resultIngredients", { count: outcome.ingredientCount })})`,
      });
    if (outcome?.unmatched?.length) facts.push({ label: t("resultUnmatched"), value: outcome.unmatched.join(", ") });
    if (outcome?.candidateName) facts.push({ label: t("resultCandidate"), value: outcome.candidateName });

    return facts;
  };

  const stuckBefore = Date.now() - STUCK_RUNNING_MS;
  const jobRows: JobRow[] = jobs.map((job) => {
    const finishedAt = job.completedAt ?? job.failedAt;
    const input = jobInput(job);
    return {
      id: job.id,
      entityType: job.entityType,
      entityId: job.entityId,
      entityName: entityName(job),
      result: jobResult(job),
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
    pageStatus: t("jobsPageStatus", { page: jobsPage, pages: jobsPageCount, total: jobsTotal }),
    previousPage: t("previousPage"),
    nextPage: t("nextPage"),
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
          {mail ? <p className={mail === "sent" ? "notice" : "notice notice-warn"}>{t(`mailStatus.${mail}` as "mailStatus.sent")}</p> : null}
        </section>
      ) : null}

      {batchSent !== undefined ? <div className="notice">{t("batchResult", { sent: Number(batchSent), failed: Number(batchFailed ?? 0) })}</div> : null}

      <section className="card" style={{ marginBottom: 20 }}>
        <h2>{t("smtp.title")}</h2>
        <p className="muted">{t("smtp.hint")}</p>
        {mailSettings ? <div className="notice">{t(`smtp.${mailSettings}` as "smtp.saved")}</div> : null}
        <form action={saveMailSettingsAction}>
          <div className="checkbox"><input id="smtp-enabled" name="enabled" type="checkbox" defaultChecked={mailConfiguration.enabled} disabled={mailConfiguration.source === "environment"} /><label htmlFor="smtp-enabled">{t("smtp.enabled")}</label></div>
          <div className="admin-grid">
            <div className="field"><label htmlFor="smtp-host">{t("smtp.host")}</label><input id="smtp-host" name="host" defaultValue={mailConfiguration.host} required disabled={mailConfiguration.source === "environment"} /></div>
            <div className="field"><label htmlFor="smtp-port">{t("smtp.port")}</label><input id="smtp-port" name="port" type="number" min="1" max="65535" defaultValue={mailConfiguration.port} required disabled={mailConfiguration.source === "environment"} /></div>
          </div>
          <div className="checkbox"><input id="smtp-secure" name="secure" type="checkbox" defaultChecked={mailConfiguration.secure} disabled={mailConfiguration.source === "environment"} /><label htmlFor="smtp-secure">{t("smtp.secure")}</label></div>
          <div className="admin-grid">
            <div className="field"><label htmlFor="smtp-user">{t("smtp.username")}</label><input id="smtp-user" name="username" defaultValue={mailConfiguration.username} disabled={mailConfiguration.source === "environment"} /></div>
            <div className="field"><label htmlFor="smtp-password">{t("smtp.password")}</label><input id="smtp-password" name="password" type="password" placeholder={mailConfiguration.password ? t("smtp.passwordStored") : ""} disabled={mailConfiguration.source === "environment"} autoComplete="new-password" /></div>
            <div className="field"><label htmlFor="smtp-from-email">{t("smtp.fromEmail")}</label><input id="smtp-from-email" name="fromEmail" type="email" defaultValue={mailConfiguration.fromEmail} required disabled={mailConfiguration.source === "environment"} /></div>
            <div className="field"><label htmlFor="smtp-from-name">{t("smtp.fromName")}</label><input id="smtp-from-name" name="fromName" defaultValue={mailConfiguration.fromName} disabled={mailConfiguration.source === "environment"} /></div>
          </div>
          <p className="hint">{t("smtp.source", { source: t(`smtp.sourceValue.${mailConfiguration.source}` as "smtp.sourceValue.none") })}</p>
          <button className="btn btn-primary" disabled={mailConfiguration.source === "environment"}>{t("smtp.save")}</button>
        </form>
      </section>

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
          <h2>{t("batchInvite")}</h2>
          <p className="muted">{t("batchInviteHint")}</p>
          <form action={batchInviteUsersAction}>
            <div className="field"><label htmlFor="recipients">{t("recipients")}</label><textarea id="recipients" name="recipients" rows={7} required placeholder={t("batchPlaceholder")} /></div>
            <div className="field"><label htmlFor="batch-role">{t("role")}</label><select id="batch-role" name="role"><option value="USER">{t("roleUser")}</option><option value="ADMIN">{t("roleAdmin")}</option></select></div>
            <button className="btn btn-primary">{t("sendBatch")}</button>
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

      <div style={{ marginTop: 20 }}>
        <PrivacyAiPanel
          aiEnabled={ownProfile?.aiEnabled ?? true}
          researchEnabled={ownProfile?.researchEnabled ?? false}
          autoApproveAi={ownProfile?.autoApproveAi ?? true}
        />
      </div>

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
        {/* The sweep refused to queue anything. Said here rather than left to be
            inferred from 25 jobs failing one after another. */}
        {enrichmentBlocked && ENRICHMENT_BLOCKS.includes(enrichmentBlocked) ? (
          <div className="notice notice-warn">
            <span className="notice-icon" aria-hidden="true">!</span>
            <span>{t(`enrichmentBlocked.${enrichmentBlocked}`)}</span>
          </div>
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
        <AiJobsPanel
          jobs={jobRows}
          counts={jobCounts}
          filter={jobsFilter}
          page={jobsPage}
          pageCount={jobsPageCount}
          labels={jobLabels}
          action={manageAiJobsAction}
        />
      </section>

      {/* The bundled food databases. An administrator needs to see whether the
          data is actually in the database - an enabled source with nothing
          imported is the one deployment mistake this feature has - and to be
          able to fix it without shell access. */}
      <section className="card" style={{ marginTop: 20 }} id="food-datasets">
        <div className="card-head">
          <div>
            <h2>{t("foodDatasets.title")}</h2>
            <p className="muted">{t("foodDatasets.subtitle")}</p>
          </div>
        </div>

        {datasetsImported !== undefined ? (
          <p className="notice" role="status">
            {t("foodDatasets.result", { imported: datasetsImported, skipped: datasetsSkipped ?? "0" })}
            {datasetsFailed ? ` ${t("foodDatasets.failed", { failed: datasetsFailed })}` : ""}
          </p>
        ) : null}

        {datasets.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>{t("foodDatasets.empty")}</p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">{t("foodDatasets.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("foodDatasets.dataset")}</th>
                    <th scope="col">{t("foodDatasets.version")}</th>
                    <th scope="col">{t("foodDatasets.bundled")}</th>
                    <th scope="col">{t("foodDatasets.imported")}</th>
                    <th scope="col">{t("foodDatasets.state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((dataset) => (
                    <tr key={dataset.key}>
                      <th scope="row" style={{ fontWeight: 500 }}>{dataset.key}</th>
                      <td className="muted">{dataset.version}</td>
                      <td>{dataset.bundledRecords.toLocaleString(locale)}</td>
                      <td>{dataset.importedRecords.toLocaleString(locale)}</td>
                      <td>
                        <span className="badge">
                          {dataset.importedAt === null
                            ? t("foodDatasets.never")
                            : dataset.upToDate
                              ? t("foodDatasets.upToDate")
                              : t("foodDatasets.outdated")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <form action={importFoodDatasetsAction}>
                <button className="btn" type="submit">{t("foodDatasets.import")}</button>
              </form>
              <form action={importFoodDatasetsAction}>
                <input type="hidden" name="force" value="1" />
                <button className="btn btn-quiet" type="submit">{t("foodDatasets.reimport")}</button>
              </form>
            </div>
          </>
        )}
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
