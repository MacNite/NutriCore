import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { hasAnyNutrient } from "@/lib/research";
import { nutrientUnit, NUTRIENT_BY_KEY } from "@/lib/nutrients";
import { getSessionUser } from "@/server/session";
import { decideResearchAction, type ResearchCandidatePayload } from "@/server/research";
import type { Locale } from "@/i18n/locales";

const nutrientName = (key: string, locale: Locale) => {
  const definition = NUTRIENT_BY_KEY.get(key);
  if (!definition) return key;
  return locale === "de" ? definition.nameDe : definition.nameEn;
};

export default async function ResearchReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const { error } = await searchParams;
  const job = await prisma.researchJob.findFirst({ where: { id, userId: user.id }, include: { sources: true, candidates: true } });
  if (!job) notFound();

  const t = await getTranslations("research");
  const candidate = job.candidates[0];
  const payload = candidate?.payload as unknown as ResearchCandidatePayload | undefined;
  // Shown in catalogue order (energy, macros, then the rest), not in whatever
  // order the values happened to be produced in.
  const nutrients = (payload ? Object.entries(payload.nutrients) : []).sort(
    ([a], [b]) => (NUTRIENT_BY_KEY.get(a)?.sortOrder ?? 9999) - (NUTRIENT_BY_KEY.get(b)?.sortOrder ?? 9999),
  );
  const usable = hasAnyNutrient(payload?.nutrients);

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("review")}</h1>
          <p className="muted">{t("status", { status: job.status })}</p>
        </div>
      </div>

      {job.status === "FAILED" ? (
        <div className="notice notice-error">{t("failed")}</div>
      ) : payload && candidate ? (
        <div className="grid-main">
          <div className="stack">
            <section className="card">
              <h2>{payload.result.name}</h2>
              <p>{payload.result.description}</p>
              <dl>
                <dt>{t("servings")}</dt>
                <dd>{String(payload.result.servings)}</dd>
                {payload.portionWeightG ? (
                  <>
                    <dt>{t("portionWeight")}</dt>
                    <dd>{formatNumber(payload.portionWeightG, user.language, 0)} g</dd>
                  </>
                ) : null}
                <dt>{t("confidence")}</dt>
                <dd>{formatNumber(Number(candidate.confidence) * 100, user.language, 0)} %</dd>
              </dl>
            </section>

            <section className="card">
              <h2>{t("ingredients")}</h2>
              {payload.matches.map((m, i) => (
                <div className="row" key={i}>
                  <div className="row-body">
                    <strong>{m.name}</strong>
                    <span>
                      {m.amount} {m.unit}
                    </span>
                  </div>
                  <span>{m.foodName ?? t("unresolved")}</span>
                </div>
              ))}
            </section>

            <section className="card">
              <h2>{t("nutrition")}</h2>
              {/* Where the numbers come from decides how much they can be trusted. */}
              <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
                {t(`nutritionSource.${payload.nutritionSource}`)}
              </p>
              {nutrients.length === 0 ? (
                <p className="empty">{t("noNutrition")}</p>
              ) : (
                nutrients.map(([key, value]) => (
                  <div className="row" key={key}>
                    <span>{nutrientName(key, user.language)}</span>
                    <strong>
                      {value === null ? "–" : `${formatNumber(value, user.language, 1)} ${nutrientUnit(key)}`}
                    </strong>
                  </div>
                ))
              )}
            </section>
          </div>

          <aside className="stack">
            <section className="card">
              <h2>{t("sources")}</h2>
              {job.sources.length ? (
                job.sources.map((s) => (
                  <p key={s.id}>
                    <a href={s.url} target="_blank" rel="noreferrer noopener external">
                      {s.title}
                    </a>
                  </p>
                ))
              ) : (
                <p className="muted">{t("noSources")}</p>
              )}
              {payload.sourceErrors?.length ? (
                <div className="notice notice-warn" style={{ marginTop: 10 }}>
                  <span className="notice-icon" aria-hidden="true">
                    !
                  </span>
                  <span>
                    {payload.sourceErrors.map((s, i) => (
                      <span key={i} style={{ display: "block", wordBreak: "break-all" }}>
                        {t(`sourceError.${s.reason}`, { url: s.url })}
                      </span>
                    ))}
                  </span>
                </div>
              ) : null}
            </section>

            <section className="card">
              <h2>{t("assumptions")}</h2>
              {payload.result.assumptions.length ? (
                <ul>
                  {payload.result.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : (
                <p>–</p>
              )}
            </section>

            {job.status === "AWAITING_CONFIRMATION" ? (
              <section className="card">
                {error === "noNutrition" || !usable ? (
                  <div className="notice notice-warn" role="alert" style={{ marginBottom: 12 }}>
                    {t("cannotAccept")}
                  </div>
                ) : null}
                <form action={decideResearchAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" name="decision" value="accept" disabled={!usable}>
                      {t("accept")}
                    </button>
                    <button className="btn" name="decision" value="reject">
                      {t("reject")}
                    </button>
                  </div>
                </form>
              </section>
            ) : null}
          </aside>
        </div>
      ) : (
        <section className="card">
          <p>{t("status", { status: job.status })}</p>
        </section>
      )}
    </AppShell>
  );
}
