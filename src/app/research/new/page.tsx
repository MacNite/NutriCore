import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/server/session";
import { researchAvailability, startResearchAction } from "@/server/research";
import { validDateKey } from "@/lib/date";

export default async function NewResearchPage({ searchParams }: { searchParams: Promise<{ q?: string; meal?: string; date?: string }> }) {
  const user = await getSessionUser(); if (!user) redirect("/login");
  const availability = researchAvailability(user); const p = await searchParams; const t = await getTranslations("research");
  return <AppShell displayName={user.displayName}><div className="page-head"><div><h1>{t("start")}</h1><p className="muted">{t("startHint")}</p></div></div>
    <section className="card"><form action={startResearchAction}>
      <input type="hidden" name="meal" value={p.meal ?? "SNACKS"}/><input type="hidden" name="date" value={validDateKey(p.date)}/>
      <div className="field"><label htmlFor="query">{t("query")}</label><input id="query" name="query" required maxLength={200} defaultValue={p.q ?? ""}/></div>
      <div className="field"><label htmlFor="sourceUrl">{t("sourceUrl")}</label><input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://…"/><span className="hint">{t("sourceHint")}</span></div>
      {!availability.available ? <div className="notice notice-warn">{t(`unavailable.${availability.reason}`)}</div> : null}
      <button className="btn btn-primary" disabled={!availability.available}>{t("start")}</button>
    </form></section></AppShell>;
}
