import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { getSessionUser } from "@/server/session";
import { decideResearchAction } from "@/server/research";

type Payload = { result: { name:string; description:string; ingredients:{name:string;amount:number;unit:string}[]; servings:number; assumptions:string[] }; matches:{name:string;amount:number;unit:string;foodName:string|null}[]; nutrients:Record<string,number|null> };
export default async function ResearchReviewPage({ params }: { params: Promise<{id:string}> }) {
 const user=await getSessionUser(); if(!user) redirect("/login"); const {id}=await params;
 const job=await prisma.researchJob.findFirst({where:{id,userId:user.id},include:{sources:true,candidates:true}}); if(!job) notFound(); const t=await getTranslations("research");
 const candidate=job.candidates[0]; const payload=candidate?.payload as unknown as Payload|undefined;
 return <AppShell displayName={user.displayName}><div className="page-head"><div><h1>{t("review")}</h1><p className="muted">{t("status",{status:job.status})}</p></div></div>
 {job.status==="FAILED"?<div className="notice notice-error">{t("failed")}</div>:payload&&candidate?<div className="grid-main"><div className="stack"><section className="card"><h2>{payload.result.name}</h2><p>{payload.result.description}</p><dl><dt>{t("servings")}</dt><dd>{payload.result.servings}</dd><dt>{t("confidence")}</dt><dd>{formatNumber(Number(candidate.confidence)*100,user.language,0)} %</dd></dl></section>
 <section className="card"><h2>{t("ingredients")}</h2>{payload.matches.map((m,i)=><div className="row" key={i}><div className="row-body"><strong>{m.name}</strong><span>{m.amount} {m.unit}</span></div><span>{m.foodName??t("unresolved")}</span></div>)}</section>
 <section className="card"><h2>{t("nutrition")}</h2>{Object.entries(payload.nutrients).map(([k,v])=><div className="row" key={k}><span>{k}</span><strong>{v===null?"–":formatNumber(v,user.language,1)}</strong></div>)}</section></div>
 <aside className="stack"><section className="card"><h2>{t("sources")}</h2>{job.sources.length?job.sources.map(s=><p key={s.id}><a href={s.url} target="_blank" rel="noreferrer noopener external">{s.title}</a></p>):<p className="muted">{t("noSources")}</p>}</section><section className="card"><h2>{t("assumptions")}</h2>{payload.result.assumptions.length?<ul>{payload.result.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul>:<p>–</p>}</section>
 {job.status==="AWAITING_CONFIRMATION"?<form action={decideResearchAction}><input type="hidden" name="jobId" value={job.id}/><div style={{display:"flex",gap:8}}><button className="btn btn-primary" name="decision" value="accept">{t("accept")}</button><button className="btn" name="decision" value="reject">{t("reject")}</button></div></form>:null}</aside></div>:<section className="card"><p>{t("status",{status:job.status})}</p></section>}</AppShell>;
}
