import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { inviteUserAction, resendInvitationAction, retryAiJobAction, setUserActiveAction } from "@/server/admin-actions";

export default async function AdminPage() {
  const current = await getSessionUser();
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  if (current.role !== "ADMIN") redirect("/");
  const [users, jobs, invitations] = await Promise.all([
    prisma.user.findMany({ include: { profile: true }, orderBy: { createdAt: "desc" } }),
    prisma.aiJob.findMany({ include: { proposal: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.userInvitation.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return <AppShell displayName={current.displayName}>
    <div className="page-head"><div><h1>Administration</h1><p className="muted">Users, invitations, and asynchronous AI work.</p></div></div>
    <div className="admin-grid">
      <section className="card"><h2>Invite user</h2><form action={inviteUserAction}>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required /></div>
        <div className="field"><label htmlFor="name">Name (optional)</label><input id="name" name="name" /></div>
        <div className="field"><label htmlFor="role">Role</label><select id="role" name="role"><option value="USER">User</option><option value="ADMIN">Administrator</option></select></div>
        <button className="btn btn-primary">Send invitation</button>
      </form></section>
      <section className="card"><h2>Recent invitations</h2><ul className="plain-list">{invitations.map(i => <li key={i.id}><strong>{i.email}</strong><br/><span className="muted">{i.acceptedAt ? "Accepted" : i.revokedAt ? "Replaced" : i.expiresAt <= new Date() ? "Expired" : "Pending"} · expires {i.expiresAt.toLocaleString()}</span>{!i.acceptedAt&&!i.revokedAt?<form action={resendInvitationAction}><input type="hidden" name="invitationId" value={i.id}/><button className="btn btn-quiet">Resend</button></form>:null}</li>)}</ul></section>
    </div>
    <section className="card" style={{marginTop:20}}><h2>Users</h2><div className="table-scroll"><table className="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.profile?.displayName ?? user.username}</strong><br/><span className="muted">{user.email}</span></td><td>{user.role}</td><td>{user.active ? "Active" : "Inactive"}{user.mustChangePassword ? " · password change required" : ""}</td><td><form action={setUserActiveAction}><input type="hidden" name="userId" value={user.id}/><input type="hidden" name="active" value={String(!user.active)}/><button className="btn btn-quiet" disabled={user.id === current.id}>{user.active ? "Deactivate" : "Reactivate"}</button></form></td></tr>)}</tbody></table></div></section>
    <section className="card" style={{marginTop:20}}><h2>AI jobs</h2><div className="table-scroll"><table className="table"><thead><tr><th>Entity</th><th>Status</th><th>Created / duration</th><th>Retries</th><th>Model</th><th>Error / action</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.entityType}<br/><code>{job.entityId}</code></td><td>{job.status}</td><td>{job.createdAt.toLocaleString()}<br/><span className="muted">{job.startedAt && (job.completedAt || job.failedAt) ? `${((job.completedAt ?? job.failedAt)!.getTime()-job.startedAt.getTime())/1000}s` : "—"}</span></td><td>{job.retryCount}</td><td>{job.model ?? "—"}</td><td>{job.errorMessage ?? (job.proposal?.approvalStatus ? `Review: ${job.proposal.approvalStatus}` : "—")}{job.status === "FAILED" ? <form action={retryAiJobAction}><input type="hidden" name="jobId" value={job.id}/><button className="btn btn-quiet">Retry</button></form> : null}</td></tr>)}</tbody></table></div></section>
  </AppShell>;
}
