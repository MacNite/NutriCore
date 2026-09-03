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
  /* Which of the two is worth saying: "nothing has looked at your photos yet"
     and "your photos are being read right now" are different waits, and a
     single "processing" for both is what made a stalled queue indistinguishable
     from a slow one. */
  const stage = scan.state === "QUEUED" ? t("review.stageQueued") : t("review.stageAnalysing");
  /* Every way a scan can end without a result. Each one gets the same way out -
     a sentence saying what happened and a link to try again - because a dead
     end with no action is the thing being fixed here. */
  const failed = scan.state === "FAILED" || scan.state === "EXPIRED" || scan.state === "TIMED_OUT";
  const failureBody = {
    TIMED_OUT: "review.timedOutBody",
    EXPIRED: "review.expiredBody",
    FAILED: "review.failedBody",
  }[scan.state] ?? "review.failedBody";

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
                from the database within the minute. Nothing to poll but state.
                Polled past the ten-minute deadline rather than up to it, so the
                refresh that sees a scan time out actually happens. */}
            <AutoRefresh intervalMs={3000} maxMinutes={12} />
            <p className="empty" aria-live="polite">
              {stage}
            </p>
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
            {/* Levels the arms crossed. Reported on an accepted scan too: they
                are the difference between a value that is missing and one that
                was never taken, and the retake advice is only useful if the
                reader knows what it would buy them. */}
            {scan.quality.reasons.length ? (
              <div className="notice" role="note" style={{ marginBottom: 14 }}>
                <span className="notice-icon" aria-hidden="true">
                  !
                </span>
                <div>
                  <strong>{t("review.partial")}</strong> {t("review.partialIntro")}
                  <ul style={{ margin: "6px 0 0" }}>
                    {scan.quality.reasons.map((reason) => (
                      <li key={reason}>{t(`quality.${reason}`)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
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
        ) : failed ? (
          <>
            <h2>{t(scan.state === "TIMED_OUT" ? "review.timedOut" : "review.failed")}</h2>
            <p className="muted">{t(failureBody)}</p>
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
