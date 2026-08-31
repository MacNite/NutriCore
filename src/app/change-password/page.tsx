import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import { changeRequiredPasswordAction } from "@/server/admin-actions";

export default async function ChangePasswordPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/");
  const p = await searchParams;
  return <main className="auth-wrap"><section className="auth-card"><h1>Choose a new password</h1><p>The initial administrator credential is temporary. Set a private password before continuing.</p>{p.error ? <div className="notice notice-warn">Use at least 10 characters and avoid common passwords.</div>:null}<form action={changeRequiredPasswordAction}><div className="field"><label htmlFor="password">New password</label><input id="password" name="password" type="password" minLength={10} required autoComplete="new-password"/></div><button className="btn btn-primary">Change password</button></form></section></main>;
}
