import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/session";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { loadScanReview } from "@/server/body-scan";
import { ScanReview } from "./scan-review";

/** A scan is worked on by the worker, so this page must never be cached. */
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("bodyScan");
  return { title: t("review.title") };
}

export default async function BodyScanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const t = await getTranslations("bodyScan");
  const scan = await loadScanReview(user.id, id);
  if (!scan) redirect("/progress");

  const working = scan.state === "QUEUED" || scan.state === "PROCESSING";

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <h1>{t("review.title")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("review.for", { date: scan.date })}
          </p>
        </div>
        <Link className="btn btn-quiet" href="/progress">
          {t("review.backToProgress")}
        </Link>
      </div>

      <section className="card">
        {working ? (
          <>
            {/* The images are already gone from the browser and will be gone
                from the database within the minute. Nothing to poll but state. */}
            <AutoRefresh intervalMs={3000} maxMinutes={10} label={t("review.working")} />
            <p className="empty">{t("review.working")}</p>
          </>
        ) : scan.state === "AWAITING_REVIEW" ? (
          <>
            <p className="muted">{t("review.intro")}</p>
            <div className="notice" role="note" style={{ marginBottom: 14 }}>
              <span className="notice-icon" aria-hidden="true">
                i
              </span>
              <span>{t("review.notAMeasurement")}</span>
            </div>
            <ScanReview scanId={scan.id} estimates={scan.estimates} locale={user.language} />
            {scan.processor ? (
              <p className="muted" style={{ marginTop: 14 }}>
                {t("review.processor", {
                  provider: scan.processor.provider,
                  model: scan.processor.model,
                  version: scan.processor.version,
                })}
              </p>
            ) : null}
            <p className="muted">{t("review.pairedNote")}</p>
          </>
        ) : scan.state === "REJECTED" && scan.quality.reasons.length ? (
          <>
            <h2>{t("review.rejected")}</h2>
            <p className="muted">{t("review.rejectedIntro")}</p>
            <ul>
              {scan.quality.reasons.map((reason) => (
                <li key={reason}>{t(`quality.${reason}`)}</li>
              ))}
            </ul>
            <Link className="btn btn-primary" href="/progress">
              {t("review.tryAgain")}
            </Link>
          </>
        ) : scan.state === "FAILED" || scan.state === "EXPIRED" ? (
          <>
            <h2>{t("review.failed")}</h2>
            <p className="muted">{t(scan.state === "EXPIRED" ? "review.expiredBody" : "review.failedBody")}</p>
            <Link className="btn btn-primary" href="/progress">
              {t("review.tryAgain")}
            </Link>
          </>
        ) : (
          <>
            <p className="empty">{t(scan.state === "ACCEPTED" ? "review.done" : "review.discarded")}</p>
            <Link className="btn" href="/progress">
              {t("review.backToProgress")}
            </Link>
          </>
        )}
      </section>
    </AppShell>
  );
}
