import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/server/session";
import { researchAvailability, startResearchAction, webSourcesAvailable } from "@/server/research";
import { validDateKey } from "@/lib/date";
import { ResearchSubmit } from "./research-submit";

const SOURCE_FIELDS = [1, 2, 3];

export default async function NewResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; meal?: string; date?: string; error?: string; retry?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const availability = researchAvailability(user);
  const withSources = webSourcesAvailable(user);
  const p = await searchParams;
  const t = await getTranslations("research");
  const retrySeconds = Number(p.retry) || 0;

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("start")}</h1>
          <p className="muted">{t("startHint")}</p>
        </div>
      </div>

      <section className="card">
        {p.error === "rateLimited" ? (
          <div className="notice notice-warn" role="alert">
            {/* A limit measured in hours reads badly in seconds. */}
            {retrySeconds >= 120
              ? t("rateLimitedRetryMinutes", { minutes: Math.ceil(retrySeconds / 60) })
              : retrySeconds > 0
                ? t("rateLimitedRetry", { seconds: retrySeconds })
                : t("rateLimited")}
          </div>
        ) : null}

        <form action={startResearchAction}>
          <input type="hidden" name="meal" value={p.meal ?? "SNACKS"} />
          <input type="hidden" name="date" value={validDateKey(p.date)} />

          <div className="field">
            <label htmlFor="query">{t("query")}</label>
            <input id="query" name="query" required maxLength={200} defaultValue={p.q ?? ""} />
          </div>

          {withSources ? (
            <>
              {SOURCE_FIELDS.map((n) => (
                <div className="field" key={n}>
                  <label htmlFor={`sourceUrl${n}`}>{t("sourceUrlN", { n })}</label>
                  <input id={`sourceUrl${n}`} name="sourceUrl" type="url" placeholder="https://…" />
                </div>
              ))}
              <p className="hint">{t("sourceHint")}</p>
            </>
          ) : (
            <p className="hint">{t("webSourcesUnavailable")}</p>
          )}

          {!availability.available ? <div className="notice notice-warn">{t(`unavailable.${availability.reason}`)}</div> : null}

          <ResearchSubmit
            label={t("start")}
            pendingLabel={t("running")}
            hint={t("runningHint")}
            disabled={!availability.available}
          />
        </form>
      </section>
    </AppShell>
  );
}
