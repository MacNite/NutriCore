import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { CopyField } from "@/components/copy-field";
import { formatDate } from "@/lib/format";
import { inviteUserAction, resendInvitationAction, retryAiJobAction, setUserActiveAction } from "@/server/admin-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("title") };
}

const JOB_LABEL = { QUEUED: "jobQueued", RUNNING: "jobRunning", COMPLETED: "jobCompleted", FAILED: "jobFailed" } as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const current = await getSessionUser();
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  if (current.role !== "ADMIN") redirect("/");

  const t = await getTranslations("admin");
  const locale = current.language;
  const { token } = await searchParams;

  const [users, jobs, invitations] = await Promise.all([
    prisma.user.findMany({ include: { profile: true }, orderBy: { createdAt: "desc" } }),
    prisma.aiJob.findMany({ include: { proposal: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.userInvitation.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

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

      <section className="card" style={{ marginTop: 20 }}>
        <h2>{t("aiJobs")}</h2>
        {jobs.length === 0 ? (
          <p className="muted">{t("noJobs")}</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("entity")}</th>
                  <th>{t("status")}</th>
                  <th>{t("created")}</th>
                  <th>{t("retries")}</th>
                  <th>{t("model")}</th>
                  <th>{t("errorAction")}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const finishedAt = job.completedAt ?? job.failedAt;
                  const duration =
                    job.startedAt && finishedAt ? (finishedAt.getTime() - job.startedAt.getTime()) / 1000 : null;
                  return (
                    <tr key={job.id}>
                      <td>
                        {job.entityType}
                        <br />
                        <code>{job.entityId}</code>
                      </td>
                      <td>{t(JOB_LABEL[job.status])}</td>
                      <td>
                        {formatDate(job.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}
                        <br />
                        <span className="muted">{duration === null ? "—" : `${duration}s`}</span>
                      </td>
                      <td>
                        {job.retryCount} / {job.maxRetries}
                      </td>
                      <td>{job.model ?? "—"}</td>
                      <td>
                        {job.errorMessage ??
                          (job.proposal?.approvalStatus ? t("reviewState", { status: job.proposal.approvalStatus }) : "—")}
                        {job.status === "FAILED" ? (
                          <form action={retryAiJobAction}>
                            <input type="hidden" name="jobId" value={job.id} />
                            <button className="btn btn-quiet">{t("retry")}</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
