import { redeemableInvitation } from "@/server/admin";
import { acceptInvitationAction } from "@/server/admin-actions";

export default async function InvitationPage({params,searchParams}:{params:Promise<{token:string}>,searchParams:Promise<{error?:string}>}) {
  const {token}=await params; const invitation=await redeemableInvitation(token); const p=await searchParams;
  return <main className="auth-wrap"><section className="auth-card"><h1>NutriCore invitation</h1>{!invitation ? <div className="notice notice-warn">This invitation is invalid, expired, or already used.</div> : <><p>Complete the account for <strong>{invitation.email}</strong>. Your administrator never sees your password.</p>{p.error ? <div className="notice notice-warn">The details could not be accepted. The username may already exist.</div>:null}<form action={acceptInvitationAction}><input type="hidden" name="token" value={token}/><div className="field"><label htmlFor="username">Username</label><input id="username" name="username" minLength={3} maxLength={40} required/></div><div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" minLength={10} required autoComplete="new-password"/></div><button className="btn btn-primary">Create account</button></form></>}</section></main>;
}
